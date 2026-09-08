import { notFound } from 'next/navigation';

import { ProductModal } from '@/components/menu/product-modal';
import { getProductBySlug } from '@/server/services/menu';

export default async function InterceptedProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) notFound();

  return <ProductModal product={product} />;
}
