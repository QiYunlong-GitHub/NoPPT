import { PNG } from 'pngjs';

export interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function decodePNG(buffer: Buffer): ImageDataLike {
  const png = PNG.sync.read(buffer);
  const data = new Uint8ClampedArray(png.width * png.height * 4);
  data.set(png.data);
  return {
    data,
    width: png.width,
    height: png.height,
  };
}
