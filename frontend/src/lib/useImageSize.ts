import { useAuth } from './AuthContext';

export type ImageSize = 'hide' | 'small' | 'large';

// Single place each page asks "what image size should I use, and how
// do I change it" -- hides the imageSizeScope branching (034) so
// Catalogue/Cart/Order Detail don't each need their own copy of it.
// 'shared' (default): every page reads/writes the one imageSizePreference
// value, same as before this preference existed. 'per_page': each page
// reads/writes its own catalogImageSize/cartImageSize/orderDetailImageSize
// column instead, independent of the other two.
export function useImageSize(page: 'catalog' | 'cart' | 'orderDetail'): [ImageSize, (v: ImageSize) => void] {
  const auth = useAuth();
  if (auth.imageSizeScope === 'per_page') {
    if (page === 'catalog') return [auth.catalogImageSize, auth.setCatalogImageSize];
    if (page === 'cart') return [auth.cartImageSize, auth.setCartImageSize];
    return [auth.orderDetailImageSize, auth.setOrderDetailImageSize];
  }
  return [auth.imageSizePreference, auth.setImageSizePreference];
}
