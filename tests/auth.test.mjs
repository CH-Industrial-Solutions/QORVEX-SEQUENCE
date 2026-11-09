import { hashPassword, verifyPassword } from '../js/auth.js';
const rec = await hashPassword('1234');
console.log('ok verify', await verifyPassword('1234', rec));
console.log('ok reject', !(await verifyPassword('0000', rec)));
console.log('salt len', rec.salt.length, 'hash len', rec.hash.length);
