import { promises as fsPromises } from 'node:fs';
import type { ResourceIdentifier } from '../../http/representation/ResourceIdentifier';
import type { ResourceLink } from './FileIdentifierMapper';
import { getExtension } from '../../util/PathUtil';
import { ExtensionBasedMapper } from './ExtensionBasedMapper';

/**
 * A hybrid mapper that performs sequential O(1) lookups for known extensions,
 * falling back to the standard ExtensionBasedMapper for everything else.
 */
export class MultipleFixedContentTypeMapper extends ExtensionBasedMapper {
  
  // Prioritized list of extensions to check for extensionless URLs
  private readonly fastExtensions = ['.nq', '.rq', '.txt', '.ttl', '.jsonld'];

  public constructor(
    base: string,
    rootFilepath: string,
    customTypes?: Record<string, string>,
  ) {
    super(base, rootFilepath, customTypes);
  }

  protected async mapUrlToDocumentPath(identifier: ResourceIdentifier, filePath: string, contentType?: string): Promise<ResourceLink> {
    const extension = getExtension(filePath);

    // FAST PATH: Extensionless GET request (e.g., /posts)
    if (!contentType && !extension && !filePath.endsWith('/')) {
      
      // The Multiple Checks Loop
      for (const ext of this.fastExtensions) {
        const testPath = `${filePath}${ext}`;
        try {
          const stats = await fsPromises.stat(testPath);
          if (stats.isFile()) {
            // We found a match! 
            // We use the parent class method so it automatically looks at your 
            // customTypes JSON dictionary to figure out the correct Content-Type.
            const mappedContentType = await this.getContentTypeFromPath(testPath);
            return {
              identifier,
              filePath: testPath,
              contentType: mappedContentType,
              isMetadata: this.isMetadataPath(filePath)
            };
          }
        } catch {
          // File with this extension doesn't exist, instantly try the next one
        }
      }
    }

    // DEFAULT PATH: Hand control back to the original ExtensionBasedMapper
    // If the loop fails, or if the client is writing a file, use standard CSS logic
    return super.mapUrlToDocumentPath(identifier, filePath, contentType);
  }
}