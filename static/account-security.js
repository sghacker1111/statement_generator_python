export function setupAccountSecurity({panel, apiUrl, fetchJson, state, logout, requestPassword, renderUsers, log}) {
  const $ = id => document.getElementById(id);
  panel.insertAdjacentHTML('beforeend', `<div class="field-grid two-col">
    <label class="field"><span>Current password</span><input id="own-current-password" type="password" autocomplete="current-password"></label>
    <label class="field"><span>New password (at least 12 characters)</span><input id="own-new-password" type="password" minlength="12" autocomplete="new-password"></label>
    <label class="field"><span>Confirm new password</span><input id="own-confirm-password" type="password" minlength="12" autocomplete="new-password"></label>
    </div><button type="button" class="primary-button" id="own-password-save">Change my password</button>
    <p id="account-security-status" role="status">After five incorrect login attempts your account stays locked until an admin unlocks it. Changing a password signs out its existing sessions.</p>
    <div class="inset-panel" id="admin-recovery-panel" hidden><h3>Admin recovery codes</h3>
    <p>Generate ten single-use codes for resetting your password if your admin account is locked. New codes replace all previous unused codes. Download and keep them privately.</p>
    <button type="button" class="ghost-button" id="recovery-generate">Generate new recovery codes</button>
    <div id="recovery-result" hidden><p>These codes are shown only once. Download them before leaving this page.</p><textarea id="recovery-code-list" readonly rows="10" aria-label="Single-use recovery codes"></textarea><button type="button" class="ghost-button" id="recovery-download">Download recovery codes</button></div></div>`);
  let codes = [], busy = false;
  const clear = () => { codes=[]; $('recovery-code-list').value=''; $('recovery-result').hidden=true; for(const id of ['own-current-password','own-new-password','own-confirm-password']) $(id).value=''; };
  const run = action => async () => { if(busy)return;busy=true;try{await action();}catch(error){$('account-security-status').textContent=error.message;log(error.message,'error');}finally{busy=false;} };
  $('own-password-save').onclick=run(async()=>{
    const current=$('own-current-password').value, password=$('own-new-password').value, confirm=$('own-confirm-password').value;
    if(!current || password.length<12)throw new Error('Enter your current password and a new password of at least 12 characters.');
    if(password!==confirm)throw new Error('New passwords do not match.');
    await fetchJson(apiUrl('change_own_password'),{method:'POST',body:JSON.stringify({current_password:current,new_password:password,confirm_password:confirm})});
    clear();await logout();$('login-error').textContent='Password changed. Sign in with your new password.';
  });
  $('recovery-generate').onclick=run(async()=>{
    const password=await requestPassword('Generate recovery codes','Enter your current admin password. This replaces all existing recovery codes.');
    if(!password)return;
    const result=await fetchJson(apiUrl('recovery_codes'),{method:'POST',body:JSON.stringify({current_password:password})});
    codes=result.codes||[];$('recovery-code-list').value=codes.join('\n');$('recovery-result').hidden=false;
    $('account-security-status').textContent='New recovery codes generated. Download them now; old codes no longer work.';
  });
  $('recovery-download').onclick=()=>{
    if(!codes.length)return;
    const blob=new Blob([`Statement Studio admin recovery\nWebsite: ${location.origin}\nUsername: ${state.currentUser?.username||''}\n\nKeep these single-use codes private.\n\n${codes.join('\n')}\n`],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download='statement-admin-recovery-codes.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const unlock=document.createElement('button');unlock.type='button';unlock.id='unlock-user-login-btn';unlock.className='ghost-button';unlock.textContent='Unlock Login';
  $('admin-manage-card')?.querySelector('.admin-actions')?.append(unlock);
  unlock.onclick=run(async()=>{
    const user_id=Number($('manage-user-select').value);if(!user_id)throw new Error('Select a user first.');
    const password=await requestPassword('Unlock account','Enter your current admin password to clear this account’s five-attempt lock.');if(!password)return;
    const result=await fetchJson(apiUrl('unlock_user_login'),{method:'POST',body:JSON.stringify({user_id,admin_password:password})});renderUsers(result.users||[]);log('The selected account can log in again.','success');
  });
  const dialog=document.createElement('dialog');dialog.id='admin-recovery-dialog';dialog.className='account-recovery-dialog';
  dialog.innerHTML=`<form><h2>Recover admin account</h2><p>Use one unused admin recovery code. It will be consumed when the password is reset.</p>
    <label class="field"><span>Admin username</span><input name="username" required autocomplete="username"></label>
    <label class="field"><span>Recovery code</span><input name="code" required autocomplete="off"></label>
    <label class="field"><span>New password</span><input name="password" type="password" required minlength="12" autocomplete="new-password"></label>
    <label class="field"><span>Confirm password</span><input name="confirm" type="password" required minlength="12" autocomplete="new-password"></label>
    <p class="recovery-error" role="alert"></p><div class="split-actions"><button type="submit" class="primary-button">Reset admin password</button><button type="button" class="ghost-button" data-cancel>Cancel</button></div></form>`;
  document.body.append(dialog);
  const recoveryButton=document.createElement('button');recoveryButton.type='button';recoveryButton.className='ghost-button';recoveryButton.id='admin-recovery-open';recoveryButton.textContent='Recover admin account';
  $('login-btn')?.parentElement?.append(recoveryButton);
  recoveryButton.onclick=()=>{dialog.querySelector('form').reset();dialog.querySelector('[name=username]').value=$('login-username').value;dialog.querySelector('.recovery-error').textContent='';dialog.showModal();};
  dialog.querySelector('[data-cancel]').onclick=()=>{dialog.querySelector('form').reset();dialog.close();};
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const f=event.currentTarget,button=f.querySelector('[type=submit]');if(button.disabled)return;
    button.disabled=true;try{
      if(f.elements.password.value!==f.elements.confirm.value)throw new Error('New passwords do not match.');
      await fetchJson(apiUrl('recover_admin'),{method:'POST',body:JSON.stringify({username:f.elements.username.value,recovery_code:f.elements.code.value,new_password:f.elements.password.value,confirm_password:f.elements.confirm.value})});
      f.reset();dialog.close();$('login-error').textContent='Admin account recovered. Sign in with your new password.';
    }catch(error){f.querySelector('.recovery-error').textContent=error.message;}finally{button.disabled=false;}
  };
  return {
    user(user){$('admin-recovery-panel').hidden=user?.role!=='admin';if(!user)clear();},
    async refresh(){if(!state.currentUser)return;const status=await fetchJson(apiUrl('account_security'));$('account-security-status').textContent=`Your account is active. Five incorrect login attempts lock an account.${state.currentUser.role==='admin'?` ${status.recovery_codes_remaining||0} unused recovery codes available.`:''}`;},
  };
}
