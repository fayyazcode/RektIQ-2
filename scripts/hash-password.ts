import { hashPassword } from "../src/lib/auth/password";

const pw = process.argv[2];
if (!pw || pw.length < 12) {
  console.error('Usage: npm run hash-password -- "a-password-of-12+-characters"');
  process.exit(1);
}
hashPassword(pw).then((h) => console.log(`ADMIN_PASSWORD_HASH=${h}`));
