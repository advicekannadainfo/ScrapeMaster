export type PriceHistoryItem = {
  price: number;
  date?: Date | string;
};

export type User = {
  email: string;
};

export type Product = {
  brand?: string;
  storeProductId?: string;
  variant?: string;
  _id: string;
  url: string;
  store: string;
  storeName: string;
  currency: string;
  image: string;
  title: string;
  currentPrice: number;
  originalPrice: number;
  priceHistory: PriceHistoryItem[];
  highestPrice: number;
  lowestPrice: number;
  averagePrice: number;
  discountRate: number;
  description: string;
  category: string;
  reviewsCount: number;
  stars: number;
  isOutOfStock: boolean;
  users?: User[];
  watchers?: number;
  offers?: Offer[];
  offersCheckedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ScrapedProduct = Omit<
  Product,
  | '_id'
  | 'priceHistory'
  | 'highestPrice'
  | 'lowestPrice'
  | 'averagePrice'
  | 'users'
  | 'watchers'
  | 'offers'
  | 'offersCheckedAt'
>;

export type NotificationType =
  'WELCOME' | 'CHANGE_OF_STOCK' | 'LOWEST_PRICE' | 'THRESHOLD_MET';

export type EmailContent = {
  subject: string;
  body: string;
};

export type EmailProductInfo = {
  title: string;
  url: string;
  image?: string;
  currency?: string;
  currentPrice?: number;
};

export type ActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string };

export type LiveProductUpdate = {
  id: string;
  currentPrice: number;
  currency: string;
  isOutOfStock: boolean;
  watchers: number;
  updatedAt: string;
};

export type Offer = {
  brand?: string;
  /** Store-local identifier; never compare this to another store's identifier. */
  storeProductId?: string;
  store: string;
  storeName: string;
  title: string;
  url: string;
  price: number;
  /** List price (MRP) shown by the store, when available. */
  originalPrice?: number;
  currency: string;
  image?: string;
};
