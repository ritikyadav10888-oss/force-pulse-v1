'use client';
import { PHOTO_TYPES, MAX_UPLOAD_BYTES } from '@force-pulse/shared';
import { useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';

const OUTPUT_PX = 512;

/** Crops the chosen area to a 512×512 JPEG, so uploads are small whatever the camera produced. */
async function cropToJpeg(src: string, area: Area): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_PX;
  canvas.height = OUTPUT_PX;
  canvas
    .getContext('2d')!
    .drawImage(img, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_PX, OUTPUT_PX);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not crop'))),
      'image/jpeg',
      0.85,
    ),
  );
}

/** Pick → crop (drag, pinch or slider to zoom) → returns a square JPEG blob. */
export function PhotoPicker({
  previewUrl,
  onCropped,
}: {
  previewUrl: string | null;
  onCropped: (blob: Blob, preview: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [error, setError] = useState('');

  function choose(file: File | undefined) {
    setError('');
    if (!file) return;
    if (!(PHOTO_TYPES as readonly string[]).includes(file.type))
      return setError('Use a JPEG or PNG photo');
    // Original can be large (it's cropped and shrunk before upload); this only guards silly sizes.
    if (file.size > 4 * MAX_UPLOAD_BYTES) return setError('That photo is too large');
    setSrc(URL.createObjectURL(file));
    setZoom(1);
  }

  async function done() {
    if (!src || !area) return;
    const blob = await cropToJpeg(src, area);
    onCropped(blob, URL.createObjectURL(blob));
    setSrc(null);
  }

  return (
    <div className="flex items-center gap-4">
      <div className="size-20 shrink-0 overflow-hidden rounded-full bg-muted">
        {previewUrl && (
          // Plain img: signed/blob URLs, nothing for the Next image optimizer to do.
          <img src={previewUrl} alt="Your photo" className="size-full object-cover" />
        )}
      </div>
      <label className="cursor-pointer text-sm font-medium text-primary underline">
        {previewUrl ? 'Change photo' : 'Add a photo'}
        <input
          type="file"
          accept="image/jpeg,image/png"
          className="sr-only"
          onChange={(e) => choose(e.target.files?.[0])}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Dialog open={!!src} onOpenChange={(open) => !open && setSrc(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crop your photo</DialogTitle>
          </DialogHeader>
          <div className="relative h-72 w-full overflow-hidden rounded-md bg-black">
            {src && (
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, px) => setArea(px)}
              />
            )}
          </div>
          <Slider
            aria-label="Zoom"
            min={1}
            max={3}
            step={0.05}
            value={[zoom]}
            onValueChange={(v) => setZoom(Array.isArray(v) ? (v[0] ?? 1) : v)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSrc(null)}>
              Cancel
            </Button>
            <Button onClick={done}>Use photo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
