import { EventEmitter } from 'node:events'
import first from './dist/index.js'
const n=Number(process.env.ITERATIONS??100000)
const start=performance.now()
for(let i=0;i<n;i++){const a=new EventEmitter();const b=new EventEmitter();first([[a,'close','error'],[b,'finish']],()=>{});b.emit('finish')}
console.log(`${(n/((performance.now()-start)/1000)).toFixed(0)} ops/s`)