import { signOutAction } from "../actions";

export default function MemberLogoutPage() {
  return <main id="main" className="min-h-dvh grid place-items-center px-4"><section className="panel p-8 w-full max-w-md"><h1 className="font-pixel text-phosphor text-sm m-0 mb-4">SIGN OUT</h1><p className="text-muted text-sm m-0 mb-6">End this member session on this device.</p><form action={signOutAction}><button className="btn">Sign out</button></form></section></main>;
}
