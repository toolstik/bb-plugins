// Turns a DOM selection into HTML without presentation: only semantic tags
// and the few attributes that carry meaning (link targets, image sources,
// table spans, list numbering) survive.

// Tags kept as they are, with attributes stripped down to KEEP_ATTRS.
const KEEP_TAGS = new Set([
  "a", "b", "blockquote", "br", "caption", "code", "dd", "del", "div", "dl", "dt",
  "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li",
  "ol", "p", "pre", "s", "strike", "strong", "sub", "sup", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "u", "ul",
]);

// Tags removed together with their content: UI chrome, not text.
const DROP_TAGS = new Set([
  "audio", "button", "canvas", "iframe", "noscript", "object", "script", "select",
  "style", "svg", "template", "textarea", "video",
]);

const KEEP_ATTRS: Record<string, readonly string[]> = {
  a: ["href"],
  img: ["src", "alt"],
  ol: ["start"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
};

// Ancestors worth repeating around a partial selection so a paste keeps the
// list, code block or emphasis the selected text came from. A blockquote is
// deliberately absent: text copied from inside a quote pastes as plain text.
const BLOCK_CONTEXT = new Set(["li", "ol", "pre", "table", "tbody", "thead", "tfoot", "tr", "ul"]);
const INLINE_CONTEXT = new Set(["a", "b", "code", "del", "em", "i", "kbd", "s", "strong", "sub", "sup", "u"]);

const BLOCK_TAGS = new Set([
  "blockquote", "dd", "div", "dl", "dt", "h1", "h2", "h3", "h4", "h5", "h6", "hr",
  "li", "ol", "p", "pre", "table", "tr", "ul",
]);

function isSafeUrl(value: string): boolean {
  return /^(https?:|mailto:|data:image\/)/i.test(value.trim());
}

function cleanNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? "");
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    const out = doc.createDocumentFragment();
    for (const child of Array.from(node.childNodes)) appendClean(out, child, doc);
    return out;
  }
  if (!(node instanceof Element)) return null;

  const tag = node.tagName.toLowerCase();
  if (DROP_TAGS.has(tag) || node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) {
    return null;
  }
  if (tag === "input") {
    const type = node.getAttribute("type");
    if (type === "checkbox") return doc.createTextNode((node as HTMLInputElement).checked ? "[x]" : "[ ]");
    return null;
  }

  if (!KEEP_TAGS.has(tag)) {
    // span, section, mark, custom elements: keep the content, lose the wrapper.
    const out = doc.createDocumentFragment();
    for (const child of Array.from(node.childNodes)) appendClean(out, child, doc);
    return out;
  }

  const out = doc.createElement(tag);
  for (const name of KEEP_ATTRS[tag] ?? []) {
    const value = node.getAttribute(name);
    if (value === null) continue;
    if ((name === "href" || name === "src") && !isSafeUrl(value)) continue;
    out.setAttribute(name, value);
  }
  for (const child of Array.from(node.childNodes)) appendClean(out, child, doc);
  return out;
}

function appendClean(parent: Node, child: Node, doc: Document): void {
  const cleaned = cleanNode(child, doc);
  if (cleaned !== null) parent.appendChild(cleaned);
}

function hasBlock(fragment: DocumentFragment): boolean {
  return Array.from(fragment.querySelectorAll("*")).some((el) => BLOCK_TAGS.has(el.tagName.toLowerCase()));
}

// Wraps the cloned range in shallow copies of its meaningful ancestors.
function withContext(range: Range, doc: Document): Node {
  const fragment = range.cloneContents();
  const multiBlock = hasBlock(fragment);
  let result: Node = fragment;
  let ancestor: Element | null =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  while (ancestor !== null && ancestor !== doc.body) {
    const tag = ancestor.tagName.toLowerCase();
    const wanted = INLINE_CONTEXT.has(tag) || tag === "pre" || (multiBlock && BLOCK_CONTEXT.has(tag));
    if (wanted) {
      const wrapper = ancestor.cloneNode(false) as Element;
      wrapper.appendChild(result);
      result = wrapper;
    }
    ancestor = ancestor.parentElement;
  }
  return result;
}

function hasContent(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").trim() !== "";
  if (!(node instanceof Element)) return false;
  return (node.textContent ?? "").trim() !== "" || node.querySelector("img, hr") !== null;
}

// A selection made entirely of quoted text drops the quote itself; a quote
// that sits among other selected content keeps its formatting.
function unwrapSoleQuote(root: Element): void {
  for (;;) {
    const meaningful = Array.from(root.childNodes).filter(hasContent);
    const only = meaningful[0];
    if (meaningful.length !== 1 || !(only instanceof Element) || only.tagName.toLowerCase() !== "blockquote") return;
    root.replaceChildren(...Array.from(only.childNodes));
  }
}

export function cleanSelectionHtml(selection: Selection): string {
  const doc = document.implementation.createHTMLDocument("");
  const root = doc.createElement("div");
  for (let i = 0; i < selection.rangeCount; i++) {
    appendClean(root, withContext(selection.getRangeAt(i), document), doc);
  }
  unwrapSoleQuote(root);
  return root.innerHTML;
}
