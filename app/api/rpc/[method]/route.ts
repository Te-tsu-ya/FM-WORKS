import {env} from 'cloudflare:workers';
import {handleRpc} from '../../../../src/server/api.mjs';
export async function POST(request:Request,context:{params:Promise<{method:string}>}){
 const {method}=await context.params;
 return handleRpc(request,env.DB,method);
}
