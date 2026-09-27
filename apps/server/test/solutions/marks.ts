import { build, type LevelSource } from '../../../../content/src/kit.ts';

/** Positions of a level source's map characters (solutions refer to tiles by them). */
export function marks(src: LevelSource) {
  const b = build(src);
  return {
    /** The tile of a character that appears once. */
    at: (c: string): [number, number] => b.pos(c),
    /** Every tile of one or more characters. */
    all: (chars: string): [number, number][] => b.all(chars),
  };
}
