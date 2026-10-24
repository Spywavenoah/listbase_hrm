const {execSync}=require('child_process');
const out = execSync('findstr /S /C:"employee_certifications" app\\', {cwd:'C:/apps/hrm_de',encoding:'utf8',stdio:['pipe','pipe','ignore']});
console.log(out);
