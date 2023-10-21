import PixelData from "./PixelData";
import type { RGB } from "./PixelData";

export default class PixelEditor {
  /** The underlying <canvas> element */
  #el: HTMLCanvasElement;

  /** The 2D canvas rendering context */
  #ctx: CanvasRenderingContext2D;

  /** The artboard size, in drawable pxiels */
  #artboard: { w: number; h: number };

  /** The underlying pixel data */
  #data = new PixelData();

  /** The selected color */
  #color: RGB = [0, 0, 0];

  /** The previous position of the mouse cursor */
  #prev: [x: number, y: number] | undefined;

  /** The set of pixel keys that have been painted during the current drag operation */
  #painted = new Set<string>();

  /** Listeners for change events */
  #listeners: Array<(state: PixelData["state"]) => void> = [];

  constructor(el: HTMLCanvasElement, artboard: { w: number; h: number }) {
    this.#el = el;

    // get the 2D rendering context
    const ctx = el.getContext("2d");
    if (!ctx) throw new Error("Couldn't get rendering context");
    this.#ctx = ctx;

    // store the artboard size
    this.#artboard = artboard;

    // listen for pointer events
    this.#el.addEventListener("pointerdown", this);
    this.#el.addEventListener("pointermove", this);
    this.#el.addEventListener("pointerup", this);

    // resize the canvas
    this.#el.width = this.#el.clientWidth * devicePixelRatio;
    this.#el.height = this.#el.clientHeight * devicePixelRatio;
    this.#ctx.scale(devicePixelRatio, devicePixelRatio);
    this.#ctx.imageSmoothingEnabled = false;
  }

  /**
   * Appends a listener to be called when the state changes.
   * @param listener */
  set onchange(listener: (state: PixelData["state"]) => void) {
    this.#listeners.push(listener);
  }

  /** Sets the drawing color. */
  set color(color: RGB) {
    this.#color = color;
  }

  /**
   * Handles events on the canvas.
   * @param e Pointer event from the canvas element.
   */
  handleEvent(e: PointerEvent) {
    switch (e.type) {
      // @ts-expect-error
      case "pointerdown": {
        this.#el.setPointerCapture(e.pointerId);
        // fallthrough
      }

      // eslint-disable-next-line no-fallthrough
      case "pointermove": {
        if (!this.#el.hasPointerCapture(e.pointerId)) return;

        // convert canvas pixels to artboard pixels
        const x = Math.floor(
            (this.#artboard.w * e.offsetX) / this.#el.clientWidth
          ),
          y = Math.floor(
            (this.#artboard.h * e.offsetY) / this.#el.clientHeight
          );

        this.#paint(x, y);
        this.#prev = [x, y];
        break;
      }

      case "pointerup": {
        this.#el.releasePointerCapture(e.pointerId);
        this.#prev = undefined;
        this.#painted.clear();
        break;
      }
    }
  }

  /**
   * Check whether a pixel has been painted during the current drag operation
   * @param x X coordinate of the target pixel.
   * @param y Y coordinate of the target pixel.
   */
  #checkPainted(x: number, y: number) {
    const key = PixelData.key(x, y);
    const painted = this.#painted.has(key);
    this.#painted.add(key);
    return painted;
  }

  /**
   * Sets pixel under the mouse cursor with the current color.
   * @param x X coordinate of the destination pixel.
   * @param y Y coordinate of the destination pixel.
   */
  #paint(x: number, y: number) {
    if (x < 0 || this.#artboard.w <= x) return;
    if (y < 0 || this.#artboard.h <= y) return;

    if (!this.#checkPainted(x, y)) this.#data.set(x, y, this.#color);

    let [x0, y0] = this.#prev || [x, y];

    const dx = x - x0,
      dy = y - y0;

    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    const xinc = dx / steps,
      yinc = dy / steps;

    for (let i = 0; i < steps; i++) {
      x0 += xinc;
      y0 += yinc;
      const x1 = Math.round(x0);
      const y1 = Math.round(y0);

      if (!this.#checkPainted(x1, y1)) this.#data.set(x1, y1, this.#color);
    }

    this.#draw();
    this.#notify();
  }

  /** Draw each pixel on the canvas. */
  async #draw() {
    /** Number of channels per pixel; R, G, B, A */
    const chans = 4;

    /** A buffer to hold the raw pixel data.
     * Each pixel corresponds to four bytes in the buffer,
     * so the full size is the number of pixels times the number of channels per pixel. */
    const buffer = new Uint8ClampedArray(
      this.#artboard.w * this.#artboard.h * chans
    );

    /** The number of bytes in the buffer representing a single artboard row. */
    const rowsize = this.#artboard.w * chans;

    for (let row = 0; row < this.#artboard.h; row++) {
      // calculate the byte offset of the start of the row relative to the start of the buffer
      const offsetY = row * rowsize;

      for (let col = 0; col < this.#artboard.w; col++) {
        // calculate the byte offset of the pixel relative to the start of the row
        const offsetX = col * chans;

        // calculate the byte offset of the pixel relative to the start of the buffer
        const offset = offsetY + offsetX;

        const [r, g, b] = this.#data.get(col, row);
        buffer[offset] = r;
        buffer[offset + 1] = g;
        buffer[offset + 2] = b;
        buffer[offset + 3] = 255;
      }
    }

    const data = new ImageData(buffer, this.#artboard.w, this.#artboard.h);
    const bitmap = await createImageBitmap(data);
    this.#ctx.drawImage(
      bitmap,
      0,
      0,
      this.#el.clientWidth,
      this.#el.clientHeight
    );
  }

  /** Notify all listeners that the state has changed. */
  #notify() {
    const state = this.#data.state;
    for (const listener of this.#listeners) listener(state);
  }

  /**
   * Merge remote state with the current state and redraw the canvas.
   * @param state State to merge into the current state. */
  receive(state: PixelData["state"]) {
    this.#data.merge(state);
    this.#draw();
  }
}
