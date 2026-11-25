/** Development log: prints in `npm run dev` builds, removed from release builds entirely. */
export const log = (...args: unknown[]): void => {
  if (__DEV__) console.log('[contacts-rail]', ...args);
};
