import {
  testSupabaseConnection,
  supabase,
  fetchProductsFromSupabase,
  insertProductToSupabase,
  updateProductQtyInSupabase,
  recordSaleInSupabase,
  logActivityToSupabase
} from './lib/supabase';

// Expose Supabase client and helper functions globally for debugging and app data integration
(window as any).supabase = supabase;
(window as any).testSupabaseConnection = testSupabaseConnection;
(window as any).supabaseHelpers = {
  fetchProductsFromSupabase,
  insertProductToSupabase,
  updateProductQtyInSupabase,
  recordSaleInSupabase,
  logActivityToSupabase
};

// Run Supabase connection test on startup
export async function initSupabaseTest() {
 
  const result = await testSupabaseConnection();

  const statusContainer = document.getElementById('supabaseStatusBadge');
  if (statusContainer) {
    statusContainer.className = 'status-badge-supabase info';
    statusContainer.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px">database</span> Local SQLite Mode`;
    statusContainer.title = 'Supabase Disconnected — App running in 100% Local SQLite Mode';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSupabaseTest);
} else {
  initSupabaseTest();
}
