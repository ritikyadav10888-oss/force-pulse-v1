'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { attributesSchema, isVisible, profileFields, type RulePack } from '@force-pulse/shared';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { DynamicField } from '@/components/dynamic-field';
import { Button } from '@/components/ui/button';
import { api, patch, post } from '@/lib/api';

type Values = Record<string, unknown>;

/** Loads the sport's current rule pack and renders its form. No sport-specific code here. */
export function SportForm({
  playerId,
  sportCode,
  existing,
  onSaved,
}: {
  playerId: string;
  sportCode: string;
  existing?: Values;
  onSaved: () => void;
}) {
  const [pack, setPack] = useState<RulePack | null>(null);
  useEffect(() => {
    void api<{ pack: RulePack }>(`/sports/${sportCode}/rule-packs/current`).then((r) =>
      setPack(r.pack),
    );
  }, [sportCode]);
  if (!pack) return <p className="text-sm text-muted-foreground">Loading form…</p>;
  return <PackForm pack={pack} playerId={playerId} existing={existing} onSaved={onSaved} />;
}

function PackForm({
  pack,
  playerId,
  existing,
  onSaved,
}: {
  pack: RulePack;
  playerId: string;
  existing?: Values;
  onSaved: () => void;
}) {
  const fields = useMemo(() => profileFields(pack), [pack]);
  const schema = useMemo(() => attributesSchema(pack), [pack]);
  const [error, setError] = useState('');
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema) as never,
    defaultValues: existing ?? {},
  });
  const values = watch();

  const onSubmit = handleSubmit(async (attributes) => {
    setError('');
    const url = `/players/${playerId}/sport-profiles/${pack.id}`;
    try {
      await (existing ? patch(url, { attributes }) : post(url, { attributes }));
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {fields
        .filter((f) => isVisible(f, values))
        .map((f) => (
          <DynamicField
            key={f.key}
            field={f}
            register={register}
            control={control}
            errors={errors}
          />
        ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : existing ? `Update ${pack.name}` : `Save ${pack.name}`}
      </Button>
      <p className="text-xs text-muted-foreground">
        Rule pack {pack.id} v{pack.version}
      </p>
    </form>
  );
}
