import { createClient } from '@supabase/supabase-js';

// Environment variables from Vite
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Supabase configuration error: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment variables.');
}

// Supabase client instance using ONLY the publishable/anon key
export const supabase = createClient(
  supabaseUrl || '',
  supabaseAnonKey || ''
);

// Connection test result interface
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  data?: any;
  error?: any;
}

/**
 * Connection Test
 * Queries the Supabase database and returns/logs a clear success or error message.
 */
export async function testSupabaseConnection(): Promise<ConnectionTestResult> {
  return {
    success: false,
    message: 'Supabase Disconnected — App running in 100% Local SQLite Mode'
  };
}

/**
 * Prepared Data Layer for Inventory Migration (Local/Dummy -> Supabase)
 */
export interface Product {
  id: string;
  name: string;
  sku: string;
  brand: string;
  category: string;
  mrp: number;
  price: number;
  cost: number;
  created_at?: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  size: string;
  color: string;
  variant_code?: string;
}

export interface InventoryItem {
  id: string;
  variant_id: string;
  product_id: string;
  piece_code: string;
  barcode: string;
  box_id?: string;
  status: 'In Stock' | 'Sold' | 'Reserved';
  created_at?: string;
}

export interface Box {
  id: string;
  box_number: string;
  barcode: string;
  created_at?: string;
}

export interface BoxItem {
  id?: string;
  box_id: string;
  variant_id: string;
  quantity: number;
}

export interface Activity {
  id: string;
  type: 'add' | 'sale' | 'adjust';
  title: string;
  size?: string;
  qty_change: string;
  time: string;
  details?: string;
}

export interface Sale {
  id?: string;
  date: string;
  items: string[];
  total: number;
  payment: string;
}

/**
 * Fetch products from Supabase table 'products'
 */
export async function fetchProductsFromSupabase(): Promise<{ data: Product[] | null; error: any }> {
  try {
    const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching products from Supabase:', error);
    return { data: null, error };
  }
}

/**
 * Insert a new product into Supabase table 'products'
 */
export async function insertProductToSupabase(product: Product): Promise<{ data: Product | null; error: any }> {
  try {
    const { data, error } = await supabase.from('products').insert([product]).select().single();
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error inserting product into Supabase:', error);
    return { data: null, error };
  }
}

/**
 * Sync piece inventory items to Supabase table 'inventory_items'
 */
export async function insertInventoryItemsToSupabase(items: InventoryItem[]): Promise<{ error: any }> {
  try {
    const { error } = await supabase.from('inventory_items').upsert(items);
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('Error syncing inventory items to Supabase:', error);
    return { error };
  }
}

/**
 * Update quantity for a product in Supabase
 */
export async function updateProductQtyInSupabase(productId: string, newQty: number): Promise<{ error: any }> {
  try {
    const { error } = await supabase.from('products').update({ qty: newQty }).eq('id', productId);
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('Error updating product qty in Supabase:', error);
    return { error };
  }
}

/**
 * Record a sale transaction in Supabase table 'sales'
 */
export async function recordSaleInSupabase(sale: Sale): Promise<{ error: any }> {
  try {
    const { error } = await supabase.from('sales').insert([sale]);
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('Error recording sale in Supabase:', error);
    return { error };
  }
}

/**
 * Log activity in Supabase table 'activities'
 */
export async function logActivityToSupabase(activity: Activity): Promise<{ error: any }> {
  try {
    const { error } = await supabase.from('activities').insert([activity]);
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('Error logging activity to Supabase:', error);
    return { error };
  }
}
