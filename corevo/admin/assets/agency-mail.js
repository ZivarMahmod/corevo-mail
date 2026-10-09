/* Corevo-owned mount for the imported mail client. No upstream server/session. */
(function () {
  'use strict';
  function mount(root, scope) {
    var disposed=false,authorized=false,editing=false,frame,transport,unsubscribe,loading=document.createElement('p'),controller=new AbortController();
    var testData=!!(scope&&scope.mailTestData),connectionError=null;
    var oldHeight=root.style.height;root.style.height='100%';
    root.classList.add('agency-native-mail');root.replaceChildren();
    loading.textContent='Öppnar Corevo Mail…';loading.setAttribute('role','status');root.appendChild(loading);
    var random=crypto.getRandomValues(new Uint8Array(16));random[6]=(random[6]&15)|64;random[8]=(random[8]&63)|128;
    var hex=Array.from(random,function(byte){return byte.toString(16).padStart(2,'0');}).join('');
    var nonce=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
    function clear(){if(disposed)return;disposed=true;controller.abort();window.removeEventListener('message',receive);if(unsubscribe)unsubscribe();if(transport)transport.dispose();if(frame&&frame.contentWindow){try{var store=frame.contentWindow.localStorage;Object.keys(store).forEach(function(k){if(k.startsWith('mailflow_'))store.removeItem(k);});}catch(_){}}root.replaceChildren();root.classList.remove('agency-native-mail');root.style.height=oldHeight;}
    if(scope&&scope.cleanup)scope.cleanup(clear);
    if(scope&&scope.beforeLeave)scope.beforeLeave(function(){return !editing||window.confirm('Lämna mejlet? Spara utkastet först om du vill behålla osparad text.');});
    function deny(){clear();var note=document.createElement('p');note.textContent='Mejlåtkomsten har ändrats. Öppna Mejl igen för din aktuella session.';note.setAttribute('role','alert');root.appendChild(note);}
    async function receive(event){
      if(disposed||!frame||event.source!==frame.contentWindow||event.origin!==location.origin||!event.data||event.data.channel!==nonce)return;
      var message=event.data;
      if(message.type==='ready'){
        try{
          if(testData){var authority=await window.CorevoZentum.personalMailbox('accounts',{}, {signal:controller.signal});if(authority.error)throw new Error('access_denied');}
          else {
            var callbackUrl=new URL(location.href);
            if(callbackUrl.pathname==='/mejl'&&callbackUrl.searchParams.has('state')&&(callbackUrl.searchParams.has('code')||callbackUrl.searchParams.has('error'))){
              var saved;try{saved=JSON.parse(sessionStorage.getItem('corevo-mail-oauth')||'null');}catch(_){}sessionStorage.removeItem('corevo-mail-oauth');
              var callback={state:callbackUrl.searchParams.get('state')};if(callbackUrl.searchParams.has('code'))callback.code=callbackUrl.searchParams.get('code');else callback.error=callbackUrl.searchParams.get('error');
              ['state','code','error','error_description','scope','authuser','prompt'].forEach(function(k){callbackUrl.searchParams.delete(k);});history.replaceState(history.state,'',callbackUrl.pathname+callbackUrl.search+callbackUrl.hash);
              var completed=await transport.completeGmail(saved,callback);if(completed.status!==200)connectionError=completed.body.error;
            }
            await transport.inventory();
          }
          var session=await window.CorevoAuth.primarySession();
          if(disposed||!session||!session.user){if(!disposed)deny();return;}
          var styles=getComputedStyle(document.documentElement),palette={};
          var mappings={'--bg-primary':'--bg','--bg-secondary':'--panel','--bg-tertiary':'--panel2','--bg-elevated':'--panel','--bg-hover':'--hover','--border':'--border','--border-subtle':'--border','--text-primary':'--text','--text-secondary':'--muted','--text-tertiary':'--muted','--accent':'--accent'};
          Object.keys(mappings).forEach(function(k){var value=styles.getPropertyValue(mappings[k]).trim();if(value)palette[k]=value;});
          authorized=true;
          event.source.postMessage({channel:nonce,type:'bootstrap',context:{testData:testData,connectionError:connectionError,user:{id:session.user.id,username:'Corevo',is_admin:false},theme:document.documentElement.dataset.theme,palette:palette}},location.origin);
        }catch(_){deny();}
      }else if(authorized&&message.type==='editing'&&typeof message.editing==='boolean')editing=message.editing;
      else if(authorized&&message.type==='request'&&Number.isSafeInteger(message.id)&&typeof message.path==='string'&&typeof message.method==='string'&&(message.body===null||typeof message.body==='string')){
        var result=await transport.request(message.path,message.method,message.body);
        if(!disposed)event.source.postMessage({channel:nonce,type:'response',id:message.id,status:result.status,body:result.body,bytes:result.bytes,contentType:result.contentType},location.origin);
      }
    }
    import(testData?'/src/modules/mail/test-transport.mjs':'/src/modules/mail/mailbox-transport.mjs').then(function(module){
      if(disposed)return;
      transport=testData?module.createMailTestTransport():module.createMailboxTransport(window.CorevoZentum.personalMailbox,{secureTransport:location.protocol==='https:'||window.isSecureContext,signal:controller.signal,onGmailBegin:function(attempt){sessionStorage.setItem('corevo-mail-oauth',JSON.stringify(attempt));}});
      var banner=document.createElement('div');banner.setAttribute('role','status');banner.textContent=testData?'Testdata – ingen riktig brevlåda ansluten. Den införlivade klienten provas; inga mejl skickas.':'Corevo Mail · Dina egna brevlådor';banner.style.cssText='padding:10px 14px;border-bottom:1px solid var(--border);background:var(--panel);font-size:13px;';
      var about=document.createElement('details'),summary=document.createElement('summary'),notice=document.createElement('p'),source=document.createElement('a'),license=document.createElement('a');summary.textContent='Om Corevo Mail';notice.textContent='Bygger på MailFlow av maathimself och bidragsgivare. Corevo-anpassningar 2026-10-09. AGPL-3.0; ingen garanti. Du får använda, dela och ändra koden enligt licensen.';source.textContent='Hämta motsvarande källkod';source.href='/corevo-mail-source.tar.gz';source.setAttribute('download','corevo-mail-source.tar.gz');license.textContent='Läs AGPL-3.0';license.href='/corevo-mail-license.txt';about.append(summary,notice,source,document.createTextNode(' · '),license);banner.append(about);
      frame=document.createElement('iframe');frame.title=testData?'Corevo Mail – införlivad klient, testdata':'Corevo Mail';frame.src='/corevo-mail#'+nonce;frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation');frame.style.cssText='display:block;width:100%;height:100%;border:0;flex:1;min-height:0;background:var(--bg);';
      var container=document.createElement('div');container.style.cssText='display:flex;flex-direction:column;width:100%;height:100%;min-height:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;';container.append(banner,frame);root.replaceChildren(container);
      window.addEventListener('message',receive);
      unsubscribe=window.CorevoZentum.subscribePersonalMailboxContext(function(change){if(change&&change.code==='reconnect_required'&&transport.connectingMicrosoft)return;deny();});
    }).catch(function(error){console.error('Corevo Mail kunde inte monteras:',error.message);if(!disposed){loading.textContent='Corevo Mail finns ännu inte i det serverade bygget. Ladda om när bygget är klart.';loading.setAttribute('role','alert');}});
    return clear;
  }
  window.CorevoAgencyMail={mount:mount};
})();
