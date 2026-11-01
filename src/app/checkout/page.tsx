import { redirect } from 'next/navigation';

/** Tiered mock checkout lands with the show pages; tickets live there now. */
export default function CheckoutMoved(): never {
  redirect('/');
}
