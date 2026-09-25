import { type CSSProperties } from "react";
import { ICON_NAME_SET, type IconName } from "./icons";

export { ICON_NAMES, ICON_NAME_SET, type IconName } from "./icons";

export interface IconProps {
  name: IconName;
  /** 20 is the list/inline size, 24 the top-bar and nav size. */
  size?: 16 | 18 | 20 | 24 | 32 | 40;
  /** Filled variant — M3 uses it to mark the selected item in a nav or tab strip. */
  filled?: boolean;
  weight?: 300 | 400 | 500 | 600;
  className?: string;
  style?: CSSProperties;
  /** Set when the icon is the only content of a control and carries the meaning. */
  title?: string;
}

/** A single Material Symbols Rounded glyph.
 *
 *  Rendered as a font ligature rather than inline SVG: one 367 kB cached request covers the
 *  whole vocabulary, the glyphs inherit `currentColor` and text metrics for free, and `FILL`
 *  is a variable axis so selection can animate from outline to filled. The names are checked
 *  against `ICON_NAMES` in development because a typo would silently render as the literal
 *  word — the subset only contains the ligatures on that list. */
export function Icon({
  name,
  size = 20,
  filled = false,
  weight = 400,
  className,
  style,
  title
}: IconProps) {
  if (import.meta.env.DEV && !ICON_NAME_SET.has(name)) {
    console.error(
      `Icon "${name}" is not in ICON_NAMES, so it is not in the font subset and will render as text. Add it to ui/kit/icons.ts and run \`npm run icons\`.`
    );
  }

  return (
    <span
      className={className ? `kit-icon ${className}` : "kit-icon"}
      style={
        {
          "--icon-size": `${size}px`,
          "--icon-fill": filled ? 1 : 0,
          "--icon-weight": weight,
          ...style
        } as CSSProperties
      }
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      translate="no"
    >
      {name}
    </span>
  );
}
