'use client';
import { useEffect,useState,type FormEvent } from 'react';
import { signIn,getProviders } from 'next-auth/react';
import { GitBranch,ArrowRight,ShieldCheck } from 'lucide-react';
export function AuthForm({mode}:{mode:'login'|'signup'|'verify'|'invite'}){
  const [ready,setReady]=useState(false);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [cognito,setCognito]=useState(false);const [token,setToken]=useState('');const [email,setEmail]=useState('');const [done,setDone]=useState(false);
  useEffect(()=>{setReady(true);getProviders().then(p=>setCognito(!!p?.cognito));const q=new URLSearchParams(location.search);setEmail(q.get('email')||'');setToken(q.get('token')||'');},[]);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const fields=Object.fromEntries(new FormData(e.currentTarget));try{
    if(mode==='login'){const r=await signIn('credentials',{...fields,redirect:false});if(r?.error)throw new Error('Check your email and password, and verify your email before signing in.');location.href='/dashboard';return;}
    const response=await fetch(mode==='invite'?'/api/organization/accept':`/api/account/${mode}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(mode==='invite'?{token}:mode==='verify'?{email,token}:fields)});const r=await response.json();if(!response.ok)throw new Error(r.error);
    if(mode==='signup'&&r.localVerificationToken){location.href=`/verify?email=${encodeURIComponent(String(fields.email))}&token=${r.localVerificationToken}`;return;}
    setDone(true);if(mode==='invite')location.href='/dashboard';
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <main className="auth-page"><div className="auth-story"><a className="brand" href="/"><GitBranch/>echo<span>.</span></a><div><span className="eyebrow">VERSION CONTROL FOR KNOWLEDGE</span><h1>Things change.<br/>Keep the whole story.</h1><p>Turn new evidence into human-verified knowledge. Every decision has a source. Every version stays in view.</p><div className="auth-flow"><span>Evidence</span><ArrowRight/><span>Review</span><ArrowRight/><span>Knowledge</span></div></div><small>AI proposes. Humans verify.</small></div><section className="auth-form"><ShieldCheck size={30}/><h2>{({login:'Welcome back',signup:'Create your workspace',verify:'Verify your email',invite:'Join your team'})[mode]}</h2>{done?<div className="notice">{mode==='signup'?'Check your email for your verification link.':'Your email is verified.'}<a className="button primary" href="/login">Continue to sign in <ArrowRight size={16}/></a></div>:<form method="post" onSubmit={submit}>
    {mode==='signup'&&<><label>Your name<input disabled={!ready} name="name" required maxLength={100} autoComplete="name"/></label><label>Organization name<input disabled={!ready} name="organizationName" required maxLength={100}/></label></>}
    {mode!=='invite'&&<label>Email<input disabled={!ready} name="email" type="email" required value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/></label>}
    {['login','signup'].includes(mode)&&<label>Password<input disabled={!ready} aria-label="Password" name="password" type="password" minLength={12} maxLength={128} required autoComplete={mode==='signup'?'new-password':'current-password'}/>{mode==='signup'&&<small>At least 12 characters.</small>}</label>}
    {mode==='verify'&&<><p className="muted">Use the token in your verification email. Local development can prefill this step without sending email.</p><label>Verification token<input disabled={!ready} value={token} onChange={e=>setToken(e.target.value)} required/></label></>}
    {mode==='invite'&&<p>Sign in using the email address your invitation was sent to, then accept to join the organization.</p>}
    {error&&<p className="error" role="alert">{error}</p>}<button className="button primary" disabled={busy||!ready}>{busy?'Please wait…':({login:'Sign in',signup:'Create account',verify:'Verify email',invite:'Accept invitation'})[mode]}<ArrowRight size={16}/></button>
  </form>}
  {cognito&&['login','signup'].includes(mode)&&<button className="button secondary" onClick={()=>signIn('cognito',{callbackUrl:'/dashboard'})}>Continue with secure organization sign-in</button>}
  <p className="auth-alternate">{mode==='login'?<>New to Echo? <a href="/signup">Create an account</a></>:<a href="/login">Back to sign in</a>}</p></section></main>;
}
