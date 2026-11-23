#!/usr/bin/env bash
# One-time GCP staging setup. Run in Google Cloud Shell (gcloud is preinstalled):
#   PROJECT_ID=your-project-id bash gcp-setup.sh
# Needs: an existing project with billing enabled, and you as Owner.
set -euo pipefail

PROJECT_ID=${PROJECT_ID:?set PROJECT_ID}
REGION=${REGION:-asia-south1}
GITHUB_REPO=${GITHUB_REPO:-ritikyadav10888-oss/force-pulse-v1}
SQL_INSTANCE=force-pulse-staging

# New service accounts take a few seconds to become visible to IAM; retry instead of failing.
retry() { for _ in 1 2 3 4 5 6 7 8 9 10; do "$@" && return 0; echo "  not ready yet, retrying in 10s..."; sleep 10; done; return 1; }

gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')

gcloud services enable run.googleapis.com artifactregistry.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com iam.googleapis.com

gcloud artifacts repositories create force-pulse --repository-format docker --location "$REGION" || true

# Cloud SQL Postgres 16, smallest tier, daily backups + point-in-time recovery.
gcloud sql instances create "$SQL_INSTANCE" --database-version POSTGRES_16 --edition ENTERPRISE \
  --tier db-f1-micro --region "$REGION" --storage-size 10 \
  --backup-start-time 20:30 --enable-point-in-time-recovery || true
gcloud sql databases create forcepulse --instance "$SQL_INSTANCE" || true
SQL_CONN=$(gcloud sql instances describe "$SQL_INSTANCE" --format 'value(connectionName)')

# Cloud Run connects through the /cloudsql unix socket; the password lives only in Secret Manager.
# Re-runs keep the existing password and secret.
if ! gcloud secrets describe database-url >/dev/null 2>&1; then
  DB_PASS=$(openssl rand -hex 24)
  gcloud sql users create forcepulse --instance "$SQL_INSTANCE" --password "$DB_PASS" \
    || gcloud sql users set-password forcepulse --instance "$SQL_INSTANCE" --password "$DB_PASS"
  gcloud secrets create database-url --replication-policy automatic
  printf '%s' "postgresql://forcepulse:${DB_PASS}@localhost/forcepulse?host=/cloudsql/${SQL_CONN}" \
    | gcloud secrets versions add database-url --data-file=-
fi

# Runtime identity for the Cloud Run services and the migrate job.
gcloud iam service-accounts create fp-runtime --display-name "Force Pulse runtime" || true
RUNTIME_SA=fp-runtime@${PROJECT_ID}.iam.gserviceaccount.com
for role in roles/cloudsql.client roles/secretmanager.secretAccessor; do
  retry gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$RUNTIME_SA" --role "$role" --condition None >/dev/null
done

# Deployer identity used by GitHub Actions (no JSON keys: Workload Identity Federation).
gcloud iam service-accounts create fp-deployer --display-name "Force Pulse GitHub deployer" || true
DEPLOYER_SA=fp-deployer@${PROJECT_ID}.iam.gserviceaccount.com
for role in roles/run.admin roles/artifactregistry.writer; do
  retry gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOYER_SA" --role "$role" --condition None >/dev/null
done
retry gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member "serviceAccount:$DEPLOYER_SA" --role roles/iam.serviceAccountUser >/dev/null

gcloud iam workload-identity-pools create github --location global --display-name GitHub || true
gcloud iam workload-identity-pools providers create-oidc github --location global --workload-identity-pool github \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping google.subject=assertion.sub,attribute.repository=assertion.repository \
  --attribute-condition "assertion.repository == '${GITHUB_REPO}'" || true
retry gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPO}" >/dev/null

cat <<EOF

Done. Set these GitHub repo variables (Settings > Secrets and variables > Actions > Variables), or run:

gh variable set GCP_PROJECT_ID --body "$PROJECT_ID" -R $GITHUB_REPO
gh variable set GCP_REGION --body "$REGION" -R $GITHUB_REPO
gh variable set GCP_WIF_PROVIDER --body "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github" -R $GITHUB_REPO
gh variable set GCP_DEPLOYER_SA --body "$DEPLOYER_SA" -R $GITHUB_REPO
gh variable set GCP_RUNTIME_SA --body "$RUNTIME_SA" -R $GITHUB_REPO
gh variable set CLOUDSQL_CONNECTION --body "$SQL_CONN" -R $GITHUB_REPO
EOF
