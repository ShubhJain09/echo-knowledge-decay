for(let attempt=0;attempt<60;attempt++){
  try{const response=await fetch('http://127.0.0.1:3001/login');if(response.ok)process.exit(0);}catch{}
  await new Promise(resolve=>setTimeout(resolve,1000));
}
throw new Error('Local server did not become ready in 60 seconds.');
