import { promises as fsPromises, constants } from 'node:fs';
import type { ResourceIdentifier } from '../../http/representation/ResourceIdentifier';
import { NotFoundHttpError } from '../../util/errors/NotFoundHttpError';
import { BaseFileIdentifierMapper } from './BaseFileIdentifierMapper';
import type { ResourceLink } from './FileIdentifierMapper';
import { NotImplementedHttpError } from '../../util/errors/NotImplementedHttpError';

/**
 * Maps HTTP resource URLs to physical file paths using predefined extensions.
 * Determines content-type based on the file extension and avoids loading
 * complete directory contents into memory to prevent allocation errors.
 */
export class MultipleFixedContentTypeMapper extends BaseFileIdentifierMapper {
  
  // Defines the sequential fallback priority for requested files lacking an explicit extension.
  // The order of extensions matters; most often requested files should be first.
  private readonly extensionTypes: Record<string, string>;
  private readonly searchExtensions: string[];
  private readonly urlSuffix;

  /**
   * @param base - Base URL.
   * @param rootFilepath - Base file path.
   * @param extensionTypes - Fixed content types that can will be used for all resources.
   * @param searchExtensions - Same context types used for search
   * @param urlSuffix - An optional suffix that will be appended to all URL.
   *                    Requested URLs without this suffix will be rejected.
   */
  public constructor(
    base: string,
    rootFilepath: string,
    extensionTypes: Record<string, string> = {
      '.nq': 'application/n-quads',
      '.rq': 'application/sparql-query',
      '.txt': 'text/plain'
    },
    searchExtensions = ['.nq', '.rq', '.txt'],
    urlSuffix = '',
  ) {
    super(base, rootFilepath);
    this.urlSuffix = urlSuffix;
    this.searchExtensions = searchExtensions;
    this.extensionTypes = extensionTypes;
  }

  protected async getContentTypeFromPath(filePath: string): Promise<string> {
    for (const [extension, contentType] of Object.entries(this.extensionTypes)) {
      if (filePath.endsWith(extension)) {
        return contentType;
      }
    }
    // Fallback to the base class default (application/octet-stream) if no match is found
    return super.getContentTypeFromPath(filePath); 
  }

  protected async getContentTypeFromUrl(identifier: ResourceIdentifier, contentType?: string): Promise<string> {
    // Reject the request if the client sends an unsupported content type
    if (contentType && !this.searchExtensions.includes(contentType)) {
      throw new NotImplementedHttpError(
        `Unsupported content type ${contentType}. Allowed types: ${this.searchExtensions.join(', ')}`
      );
    }
    // Return the provided type, or let the base class handle the default (application/octet-stream)
    return contentType || super.getContentTypeFromUrl(identifier, contentType);
  }

  public async mapUrlToDocumentPath(identifier: ResourceIdentifier, filePath: string, contentType?: string):
    Promise<ResourceLink> {
    if (this.urlSuffix) {
      if (filePath.endsWith(this.urlSuffix)) {
        filePath = filePath.slice(0, -this.urlSuffix.length);
      } else {
        this.logger.warn(`Attempted to access URL ${filePath} without required suffix ${this.urlSuffix}`);
        throw new NotFoundHttpError(`Attempted to access URL ${filePath} without required suffix ${this.urlSuffix}`);
      }
    }

    // Search for existing file with supported extensions
    for (const extension of this.searchExtensions) {
      const testPath = filePath + extension;
      if (await this.fileExists(testPath)) {
        return super.mapUrlToDocumentPath(identifier, testPath, contentType);
      }
    }

    // Could not find the file with the extension
    throw new NotFoundHttpError(
      `URL ${filePath} is not backed by a file matching extensions: ${this.searchExtensions.join(', ')}`,
    );
  }

  protected async getDocumentUrl(relative: string): Promise<string> {
    let matchedExtension = false;

    // Strip the file extension (ignore metadata files)
    if (!this.isMetadataPath(relative)) {
      for (const extension of this.searchExtensions) {
        if (relative.endsWith(extension)) {
          relative = relative.slice(0, -extension.length);
          matchedExtension = true;
          break;
        }
      }

      if (!matchedExtension) {
        this.logger.warn(`File ${relative} lacks a supported extension: ${this.searchExtensions.join(', ')}`);
        throw new NotFoundHttpError(`File ${relative} is not part of the file storage at ${this.rootFilepath}`);
      }
    }

    // Append the required URL suffix
    return super.getDocumentUrl(relative + this.urlSuffix);
  }
  /**
   * Verifies file existence directly to bypass memory-intensive directory scans.
   */
  private async fileExists(path: string): Promise<boolean> {
    try {
      await fsPromises.access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}