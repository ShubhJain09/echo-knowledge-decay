import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import CognitoProvider from 'next-auth/providers/cognito';
import { z } from 'zod';
import { account, createAccount, verifyPassword, saveUser, auditAccount } from './accounts';
import { rateLimit } from './security';
export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy:'jwt',maxAge:8*60*60 },
  pages: { signIn:'/login',error:'/login' },
  providers:[
    CredentialsProvider({ name:'Email and password',credentials:{email:{label:'Email',type:'email'},password:{label:'Password',type:'password'}},async authorize(credentials){
      const input=z.object({email:z.email().max(254),password:z.string().min(12).max(128)}).safeParse(credentials);
      if(!input.success)return null;
      await rateLimit(`login:${input.data.email.toLowerCase()}`,10,900);
      const row=await account(input.data.email);
      if(!row || row.data.identityProvider!=='local' || row.data.status!=='active' || !verifyPassword(input.data.password,row.data.passwordHash||''))return null;
      await saveUser(row,{...row.data,lastSeenAt:new Date().toISOString()}); await auditAccount(row.data,'auth.login');
      return {id:row.data.id,email:row.data.email,name:row.data.name};
    }}),
    ...(process.env.COGNITO_CLIENT_ID && process.env.COGNITO_CLIENT_SECRET && process.env.COGNITO_ISSUER ? [CognitoProvider({ clientId:process.env.COGNITO_CLIENT_ID,clientSecret:process.env.COGNITO_CLIENT_SECRET,issuer:process.env.COGNITO_ISSUER,checks:['pkce','state','nonce'] })] : []),
  ],
  callbacks:{
    async signIn({user,account:provider,profile}) {
      if(provider?.provider!=='cognito')return true;
      const p=profile as {email_verified?:boolean;sub?:string};
      if(p.email_verified!==true || !user.email || !p.sub)return false;
      let row=await account(user.email);
      if(!row){await createAccount({name:user.name||user.email,email:user.email,organizationName:`${user.name||'My'} workspace`,provider:'cognito',subject:p.sub});row=await account(user.email);}
      if(!row || row.data.identityProvider!=='cognito' || row.data.id!==p.sub || row.data.status!=='active')return false;
      await auditAccount(row.data,'auth.login'); return true;
    },
    async jwt({token,user}) {
      if(user?.email){const row=await account(user.email);token.email=user.email;token.sessionVersion=row?.data.sessionVersion;token.authenticatedAt=Date.now();}
      return token;
    },
    async session({session,token}) { if(session.user) { (session as unknown as {sessionVersion:unknown}).sessionVersion=token.sessionVersion; (session as unknown as {authenticatedAt:unknown}).authenticatedAt=token.authenticatedAt; } return session; },
  },
};
