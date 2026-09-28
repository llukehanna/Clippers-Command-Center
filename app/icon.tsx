import { ImageResponse } from 'next/og'
import { iconArt } from './_icon-art'

export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

export default async function Icon() {
  return new ImageResponse(await iconArt(size.width), size)
}
