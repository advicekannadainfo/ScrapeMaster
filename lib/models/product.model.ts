import mongoose, { type InferSchemaType, type Model } from 'mongoose';

const priceHistorySchema = new mongoose.Schema(
  {
    price: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  { email: { type: String, required: true, lowercase: true, trim: true } },
  { _id: false },
);

const offerSchema = new mongoose.Schema(
  {
    store: { type: String, required: true },
    storeName: { type: String, required: true },
    brand: String,
    variant: String,
    canonicalIdentity: mongoose.Schema.Types.Mixed,
    priceObservation: mongoose.Schema.Types.Mixed,
    exactEvidence: mongoose.Schema.Types.Mixed,
    title: { type: String, required: true },
    url: { type: String, required: true },
    price: { type: Number, required: true },
    savedTrackedProduct: Boolean,
    currency: { type: String, required: true },
    image: String,
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, unique: true },
    store: { type: String, default: 'amazon' },
    storeName: { type: String, default: 'Amazon' },
    brand: String,
    storeProductId: String,
    comparisonIdentityVerified: Boolean,
    productLinks: mongoose.Schema.Types.Mixed,
    variant: String,
    canonicalIdentity: mongoose.Schema.Types.Mixed,
    priceObservation: mongoose.Schema.Types.Mixed,
    exactEvidence: mongoose.Schema.Types.Mixed,
    currency: { type: String, required: true },
    image: { type: String, required: true },
    title: { type: String, required: true },
    currentPrice: { type: Number, required: true },
    originalPrice: { type: Number, required: true },
    priceHistory: { type: [priceHistorySchema], default: [] },
    lowestPrice: Number,
    highestPrice: Number,
    averagePrice: Number,
    discountRate: { type: Number, default: 0 },
    description: String,
    category: String,
    reviewsCount: Number,
    stars: Number,
    isOutOfStock: { type: Boolean, default: false },
    users: { type: [userSchema], default: [] },
    offers: { type: [offerSchema], default: [] },
    offersCheckedAt: Date,
    candidateLinksCheckedAt: Date,
  },
  { timestamps: true },
);

productSchema.index({ updatedAt: -1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ store: 1, updatedAt: -1 });
// Serves the similar products query (category match, newest first).
productSchema.index({ category: 1, updatedAt: -1 });

export type ProductDocument = InferSchemaType<typeof productSchema>;

const Product: Model<ProductDocument> =
  (mongoose.models.Product as Model<ProductDocument>) ||
  mongoose.model<ProductDocument>('Product', productSchema);

export default Product;
