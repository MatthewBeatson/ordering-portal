import { Button } from '@/components/ui/button';
import { Image as ImageIcon } from 'lucide-react';

export type ImageSize = 'hide' | 'small' | 'large';

const CYCLE: ImageSize[] = ['hide', 'small', 'large'];
const LABEL: Record<ImageSize, string> = { hide: 'Images: Hide', small: 'Images: Small', large: 'Images: Large' };

function next(value: ImageSize): ImageSize {
  return CYCLE[(CYCLE.indexOf(value) + 1) % CYCLE.length];
}

// Single button that cycles Hide -> Small -> Large -> Hide on each
// click, same interaction as the original on/off "Include images"
// toggle just extended to a third state. "Small" matches the size
// these pages already used; "Large" is deliberately bigger than the
// Catalog thumbnail (80px) since this is an on-demand closer look, not
// a dense browsing view.
export function ImageSizeToggle({ value, onChange }: { value: ImageSize; onChange: (v: ImageSize) => void }) {
  return (
    <Button size="sm" variant={value === 'hide' ? 'secondary' : 'primary'} onClick={() => onChange(next(value))}>
      <ImageIcon className="h-3.5 w-3.5" />
      {LABEL[value]}
    </Button>
  );
}

// Full ImageSize keys (including 'hide', unused/empty) so callers never
// need an `as Exclude<...>` cast just to index these from a plain
// ImageSize-typed variable.
export const IMAGE_SIZE_CLASS: Record<ImageSize, string> = {
  hide: '',
  small: 'h-12 w-12',
  large: 'h-32 w-32',
};

export const IMAGE_COL_CLASS: Record<ImageSize, string> = {
  hide: '',
  small: 'w-16',
  large: 'w-36',
};
