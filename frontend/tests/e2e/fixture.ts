import {test as base,expect} from '@playwright/test';
export {expect};
export const test=base.extend({
  page:async({page},use)=>{
    await page.route('https://test.supabase.co/**',route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
    await page.addInitScript(()=>localStorage.setItem('sb-test-auth-token',JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',expires_at:4102444800,expires_in:3600,token_type:'bearer',user:{id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',email:'investigator@example.test',user_metadata:{full_name:'Test Investigator'},app_metadata:{},created_at:'2026-01-01T00:00:00Z'}})));
    await use(page);
  }
});
