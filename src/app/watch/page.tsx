import { redirect } from 'next/navigation';

/** Legacy demo-stream URL. Everyone watches through their show's page now. */
export default function WatchRedirect(): never {
  redirect('/shows/demo-night');
}
