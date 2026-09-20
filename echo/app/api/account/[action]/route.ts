import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { createAccount,account,hash,saveUser,auditAccount,publicUser,verifyPassword,passwordHash,sendVerification } from '@/lib/auth/accounts';
import { checkOrigin,readJson,rateLimit } from '@/lib/auth/security';
import { requireActor,requireRecentLogin } from '@/lib/auth/session';
import { valid,text } from '@/lib/types/schemas';
import { AppError } from '@/lib/errors';
export async function POST(request:NextRequest,{params}:{params:Promise<{action:string}>}) {
  try{
    if(!checkOrigin(request.headers.get('origin'),request.headers.get('host')))throw new AppError(403,'Cross-origin requests are not allowed.');
    const {action}=await params;const body=await readJson(request,10000);
    // Shared ingress limiter does not trust client-supplied forwarding headers.
    await rateLimit(`account:${action}`,100,60);
    if(action==='signup') {
      const input=valid(z.object({name:text(100),email:z.email().max(254),password:z.string().min(12).max(128),organizationName:text(100)}).strict(),body);
      if(!process.env.EMAIL_FROM && !(process.env.ECHO_LOCAL_MAIL==='true' && process.env.NODE_ENV!=='production' && process.env.ECHO_STORAGE!=='aws'))throw new AppError(503,'Email verification is not configured. Use Cognito signup or configure email delivery.');
      const {code}=await createAccount({...input,provider:'local'});
      return NextResponse.json({ok:true,...(process.env.ECHO_LOCAL_MAIL==='true' && process.env.NODE_ENV!=='production' && process.env.ECHO_STORAGE!=='aws'?{localVerificationToken:code}: {})},{status:201});
    }
    if(action==='verify'){
      const input=valid(z.object({email:z.email(),token:text(100)}).strict(),body);await rateLimit(`verify:${input.email}`,10,900);
      const row=await account(input.email);
      if(!row || row.data.status!=='pending' || !row.data.verificationHash || !timingSafeEqual(Buffer.from(row.data.verificationHash),Buffer.from(hash(input.token))) || Date.parse(row.data.verificationExpires||'')<Date.now())throw new AppError(400,'This verification link is invalid or expired.');
      await saveUser(row,{...row.data,status:'active',verificationHash:undefined,verificationExpires:undefined});await auditAccount(row.data,'auth.verified');return NextResponse.json({ok:true});
    }
    if(action==='resend'){
      const input=valid(z.object({email:z.email()}).strict(),body);await rateLimit(`resend:${input.email}`,3,3600);const row=await account(input.email);
      if(row?.data.status==='pending'){const code=randomBytes(24).toString('hex');await saveUser(row,{...row.data,verificationHash:hash(code),verificationExpires:new Date(Date.now()+86400000).toISOString()});await sendVerification(input.email,code);}
      return NextResponse.json({ok:true});
    }
    const actor=await requireActor();const row=(await account(actor.email))!;
    if(action==='profile'){
      const input=valid(z.object({name:text(100),timezone:text(100),notifications:z.boolean()}).strict(),body);
      try{new Intl.DateTimeFormat('en',{timeZone:input.timezone});}catch{throw new AppError(400,'Enter a valid timezone.');}
      await saveUser(row,{...row.data,...input});await auditAccount(row.data,'account.profile');return NextResponse.json(publicUser({...row.data,...input}));
    }
    if(action==='revoke-sessions'){valid(z.object({}).strict(),body);await requireRecentLogin();await saveUser(row,{...row.data,sessionVersion:row.data.sessionVersion+1});await auditAccount(row.data,'auth.revoke_all');return NextResponse.json({ok:true});}
    if(action==='password'){
      await requireRecentLogin();const input=valid(z.object({currentPassword:z.string().max(128),password:z.string().min(12).max(128)}).strict(),body);
      if(row.data.identityProvider!=='local'||!verifyPassword(input.currentPassword,row.data.passwordHash||''))throw new AppError(400,'Current password is incorrect.');
      await saveUser(row,{...row.data,passwordHash:passwordHash(input.password),sessionVersion:row.data.sessionVersion+1});await auditAccount(row.data,'auth.password');return NextResponse.json({ok:true});
    }
    throw new AppError(404,'Account action not found.');
  }catch(e){return NextResponse.json({error:e instanceof AppError?e.message:'Account request failed.'},{status:e instanceof AppError?e.status:500});}
}
