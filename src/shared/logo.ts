import { el } from "./dom";

/**
 * The BoopPr pug mark, inlined rather than loaded: the sandbox's CSP serves
 * images only from the package, and an inline SVG follows the text colour for
 * free. Same shape as `assets/boop.svg`, the rail icon.
 */
const FACE =
  '<ellipse cx="12" cy="15.3" rx="3.6" ry="2.9" fill="#000"/><circle cx="8.7" cy="10.4" r="1.15" fill="#000"/><circle cx="15.3" cy="10.4" r="1.15" fill="#000"/><path d="M9.6 6.1c1.6-.9 3.2-.9 4.8 0l-.55 1.1c-1.25-.7-2.45-.7-3.7 0z" fill="#000"/>';
const SILHOUETTE =
  '<circle cx="12" cy="12.6" r="8.4"/><path d="M3.6 3.8C2.7 6.8 2.9 10 4.3 12.6c.5.9 1.4.9 1.9 0C7 10.6 8 8.6 9.6 7L7.2 4.2C6 4 4.8 3.8 3.6 3.8z"/><path d="M20.4 3.8c.9 3 .7 6.2-.7 8.8-.5.9-1.4.9-1.9 0C17 10.6 16 8.6 14.4 7l2.4-2.8c1.2-.2 2.4-.4 3.6-.4z"/>';

let maskSequence = 0;

export function boopMark(size = 16): SVGSVGElement {
  maskSequence += 1;
  const id = `boop-face-${maskSequence}`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("boop-mark");
  svg.innerHTML =
    `<defs><mask id="${id}"><rect width="24" height="24" fill="#fff"/>${FACE}</mask></defs>` +
    `<g fill="currentColor" mask="url(#${id})">${SILHOUETTE}</g>`;
  return svg;
}

/** The wordmark row used to head the full-screen page and the attach dialog. */
export function boopWordmark(text: string): HTMLElement {
  return el("span", { className: "boop-wordmark" }, boopMark(16), el("span", {}, text));
}
