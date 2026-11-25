/** True in `npm run dev` builds only; dead code is removed from release builds. */
declare const __DEV__: boolean;

/** CSS files are bundled as strings and adopted into shadow roots. */
declare module '*.css' {
  const css: string;
  export default css;
}
