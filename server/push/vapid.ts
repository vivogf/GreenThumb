/** Contact for push services (RFC 8292). */
export const VAPID_SUBJECT = "mailto:greenthumbapp@proton.me";

type SetVapidDetails = (subject: string, publicKey: string, privateKey: string) => void;

export function configureVapid(env: NodeJS.ProcessEnv, setVapidDetails: SetVapidDetails): boolean {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
  return true;
}
