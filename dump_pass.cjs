const fs = require('fs');
const s = fs.readFileSync('C:/apps/hrm_de/app/(dashboard)/employees/[id]/personal/page.tsx','utf8');
const idx = s.indexOf('Passport Details');
console.log(s.substring(Math.max(0, idx-500), Math.min(s.length, idx+800)));
