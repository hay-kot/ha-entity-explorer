// A new bundle URL (after an update or an entry reload) loads this module again
// in a page that already defined these elements, and a second define throws.
// The elements already defined keep working until the page reloads.
export function define(name: string, element: CustomElementConstructor) {
  if (!customElements.get(name)) customElements.define(name, element);
}
