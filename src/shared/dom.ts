import DOMPurify from "dompurify";
import { marked } from "marked";
import { host } from "./host";

/**
 * Props for `el`. `style` takes a CSS string rather than a declaration, and
 * `on<Event>` handlers are attached as listeners instead of assigned.
 */
export type ElProps<K extends keyof HTMLElementTagNameMap> = Partial<
  Omit<HTMLElementTagNameMap[K], "style" | "dataset">
> & {
  style?: string;
  dataset?: Record<string, string>;
  [key: `on${string}`]: ((event: Event) => void) | undefined;
};

/**
 * Small DOM helper. The UI kit covers controls; this covers the layout the kit
 * has no block for, such as the finding tables on the detail sheets.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps<K> = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === "dataset") {
      Object.assign(node.dataset, value as Record<string, string>);
      continue;
    }
    if (key === "style") {
      node.setAttribute("style", String(value));
      continue;
    }
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      continue;
    }
    if (key === "className" && typeof value === "string") {
      node.className = value;
      continue;
    }
    (node as unknown as Record<string, unknown>)[key] = value;
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

/**
 * Render Markdown for PR bodies and finding rationales. The iframe is
 * sandboxed, so everything is sanitized before it reaches the document, and
 * every link is handed to the host because a sandboxed frame cannot navigate
 * itself.
 */
export function renderMarkdown(markdown: string | null | undefined): HTMLElement {
  const wrapper = el("div", { className: "md" });
  if (!markdown || markdown.trim().length === 0) {
    wrapper.append(el("p", { className: "muted" }, "Nothing written."));
    return wrapper;
  }

  const html = marked.parse(markdown, { async: false, gfm: true, breaks: true });
  wrapper.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });

  wrapper.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") ?? "";
    anchor.setAttribute("rel", "noreferrer noopener");
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      if (/^https?:\/\//i.test(href)) {
        void host.openUrl(href);
      }
    });
  });

  wrapper.querySelectorAll("img").forEach((image) => {
    image.setAttribute("loading", "lazy");
  });

  return wrapper;
}

/** Collapse a long body behind a Read more toggle. */
export function collapsibleMarkdown(markdown: string | null | undefined, limit = 320): HTMLElement {
  const text = markdown ?? "";
  const body = renderMarkdown(markdown);
  if (text.length <= limit) return body;

  body.classList.add("md-collapsed");
  const toggle = el(
    "button",
    { className: "link-button", type: "button" },
    "Show full description",
  );
  toggle.addEventListener("click", () => {
    const collapsed = body.classList.toggle("md-collapsed");
    toggle.textContent = collapsed ? "Show full description" : "Show less";
  });
  return el("div", { className: "md-wrap" }, body, toggle);
}
