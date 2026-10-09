import {it,expect} from 'vitest';
import path from 'node:path';
import {corevoMailPlugin} from '../../../platform/build/corevo-mail-plugin';

it('fails closed when the client is missing or imports private source through another chunk',async()=>{
 const hook=corevoMailPlugin().generateBundle as Function;
 await expect(hook.call({}, {}, {})).rejects.toThrow('entry is missing');
 const client={type:'chunk',isEntry:true,facadeModuleId:path.resolve('src/modules/mail/client.html'),fileName:'client.js',modules:{},imports:[],dynamicImports:['private.js']};
 const privateChunk={type:'chunk',modules:{[path.resolve('src/private/auth.ts')]:{}},imports:[],dynamicImports:[]};
 await expect(hook.call({}, {}, {'client.js':client,'private.js':privateChunk})).rejects.toThrow('Private code reached');
});
