import { ImageResponse } from 'next/og'
import { iconArt } from './_icon-art'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default async function AppleIcon() {
  return new ImageResponse(await iconArt(size.width), size)
}
