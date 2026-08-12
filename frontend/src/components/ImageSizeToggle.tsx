import { Button } from '@/components/ui/button';
import { Image as ImageIcon } from 'lucide-react';

export type ImageSize = 'hide' | 'small' | 'large';

const FULL_CYCLE: ImageSize[] = ['hide', 'small', 'large'];
const NO_HIDE_CYCLE: ImageSize[] = ['small', 'large'];
const LABEL: Record<ImageSize, string> = { hide: 'Images: Hide', small: 'Images: Small', large: 'Images: Large' };

function next(value: ImageSize, cycle: ImageSize[]): ImageSize {
  const i = cycle.indexOf(value);
  return cycle[(i === -1 ? 0 : i + 1) % cycle.length];
}

// Single button that cycles through the sizes on each click, same
// interaction as the original on/off "Include images" toggle just
// extended to more states. "Small" is a comfortable step up from
// Catalog's old fixed 80px default; "Large" is a genuine close-up view,
// not just "a bit bigger" -- see IMAGE_SIZE_CLASS below.
//
// allowHide=false drops "Hide" from the cycle entirely (used on Cart --
// deliberately can't be turned off there, so a buyer can never lose
// sight of what they're actually about to submit vs. what they think
// they're ordering).
export function ImageSizeToggle({
  value,
  onChange,
  allowHide = true,
}: {
  value: ImageSize;
  onChange: (v: ImageSize) => void;
  allowHide?: boolean;
}) {
  const cycle = allowHide ? FULL_CYCLE : NO_HIDE_CYCLE;
  return (
    <Button size="sm" variant={value === 'hide' ? 'secondary' : 'primary'} onClick={() => onChange(next(value, cycle))}>
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
  small: 'h-24 w-24', // 96px
  large: 'h-56 w-56', // 224px -- a genuine close-up, not just "bigger"
};

export const IMAGE_COL_CLASS: Record<ImageSize, string> = {
  hide: '',
  small: 'w-28',
  large: 'w-64',
};
