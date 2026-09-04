/**
 * jsdom does no real layout, so every element's `offsetParent` is always
 * `null` — the "is this field actually visible" checks scattered across the
 * autofill code (`engine.ts`, `checkboxes.ts`, `pick-questions.ts`) would
 * reject *every* field in a jsdom-rendered fixture. None of the fixtures
 * this suite loads deliberately hide a field, so treat "has a parent" as
 * "visible" instead — good enough for these tests, and it's exactly the
 * same class of stub `@testing-library/jest-dom`-based projects use.
 */
Object.defineProperty(HTMLElement.prototype, "offsetParent", {
  configurable: true,
  get(this: HTMLElement) {
    return this.parentElement;
  },
});

// jsdom always reports `isContentEditable` as `false` — it doesn't
// implement the browser's full editing-host algorithm. `native-setter.ts`
// branches on this property (not the raw attribute) to fill a
// `contenteditable` field, so approximate it from the attribute instead —
// exactly what a `contenteditable="true"`/`contenteditable=""` element
// resolves to in every real browser with no ancestor overriding it, which
// covers every fixture this suite uses.
Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
  configurable: true,
  get(this: HTMLElement) {
    const value = this.getAttribute("contenteditable");
    return value === "" || value === "true";
  },
});

// jsdom has no `DataTransfer`/`DragEvent` implementation — used by the
// file-upload/drop-zone injection code. A minimal stand-in is enough: the
// code under test only ever calls `.items.add(file)` and reads `.files`.
if (typeof globalThis.DataTransfer === "undefined") {
  class FakeDataTransfer {
    #files: File[] = [];
    items = {
      add: (file: File) => {
        this.#files.push(file);
      },
    };
    get files(): FileList {
      return this.#files as unknown as FileList;
    }
  }
  // @ts-expect-error -- minimal test-only stand-in, not a full DataTransfer
  globalThis.DataTransfer = FakeDataTransfer;
}

// `input.files = …` (real production code, `inject-file.ts`) goes through
// jsdom's own strict WebIDL setter, which only accepts jsdom's *internal*
// `FileList` class — not a plain array, and jsdom exposes no public
// `FileList` constructor to build one, so even a spec-accurate
// `DataTransfer` can't satisfy it from outside jsdom itself. Replace the
// whole accessor with a permissive array-backed one so the assignment in
// production code just works, the same way every other missing jsdom
// browser API in this file is stood in for.
{
  const filesByInput = new WeakMap<HTMLInputElement, File[]>();
  Object.defineProperty(HTMLInputElement.prototype, "files", {
    configurable: true,
    get(this: HTMLInputElement) {
      const files = filesByInput.get(this) ?? [];
      return Object.assign([...files], { item: (i: number) => files[i] ?? null }) as unknown as FileList;
    },
    set(this: HTMLInputElement, value: FileList | ArrayLike<File> | null) {
      filesByInput.set(this, value ? Array.from(value as ArrayLike<File>) : []);
    },
  });
}
if (typeof globalThis.DragEvent === "undefined") {
  class FakeDragEvent extends Event {
    dataTransfer: DataTransfer | null;
    constructor(type: string, init?: DragEventInit) {
      super(type, init);
      this.dataTransfer = (init?.dataTransfer as DataTransfer | undefined) ?? null;
    }
  }
  // @ts-expect-error -- minimal test-only stand-in, not a full DragEvent
  globalThis.DragEvent = FakeDragEvent;
}

// jsdom logs a scary "Not implemented: document.execCommand" error to the
// console (via its virtual console) and returns undefined rather than
// throwing — `native-setter.ts`'s contenteditable path already handles a
// falsy return by falling back to a manual text-node insert, so the
// behavior under test is correct either way. Stub it directly so test
// output isn't full of that noise.
document.execCommand = () => false;
