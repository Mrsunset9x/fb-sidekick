/**
 * Runs in the page's own JavaScript world inside the docked frame, before
 * Messenger starts. The Facebook page around the panel already plays the
 * message sound and shows notifications; without this, every message would
 * ping twice. Call audio (a MediaStream) is left alone.
 */
import { FRAME_NAME, RANKER_NAME } from '../shared/protocol';

if (window.top !== window && (window.name === FRAME_NAME || window.name === RANKER_NAME)) {
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    return this.srcObject ? play.call(this) : Promise.resolve();
  };

  if ('Notification' in window) {
    const Silent = function () {
      return new EventTarget();
    } as unknown as typeof Notification;
    Object.defineProperty(Silent, 'permission', { get: () => Notification.permission });
    (Silent as { requestPermission: () => Promise<NotificationPermission> }).requestPermission = () =>
      Promise.resolve(Notification.permission);
    Object.defineProperty(window, 'Notification', { value: Silent, configurable: true, writable: true });
  }
}
