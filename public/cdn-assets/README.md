# CDN Assets

This folder contains large static assets that will be deployed to the CDN.

## How it works

1. **Add your assets here** (images, audio, videos, etc.)
2. **Deploy game using rundot cli** rundot deploy
3. **cdn-assets will be uploaded to the CDN** versioning is also handled for you

## Usage in Phaser

```typescript
import RundotGameAPI from '@series-inc/rundot-game-sdk/api';

// Fetch an asset blob from the CDN and load it into Phaser:
const blob = await RundotGameAPI.cdn.fetchAsset('my-sprite.png');
const blobUrl = URL.createObjectURL(blob);

this.load.image('my-sprite', blobUrl);
this.load.once('complete', () => {
  URL.revokeObjectURL(blobUrl);
  this.add.image(400, 300, 'my-sprite');
});
this.load.start();
```

**Note:** Assets are uploaded to the CDN automatically when you deploy with `rundot deploy`.

## Important Notes

- **DO** commit assets to this folder
- Use `public/` folder for small essential assets (<100KB)
- Use `public/cdn-assets` folder for large assets (>100KB)
