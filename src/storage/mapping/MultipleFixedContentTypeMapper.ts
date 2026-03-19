import { promises as fsPromises, constants } from 'node:fs';
import * as mime from 'mime-types';
import type { ResourceIdentifier } from '../../http/representation/ResourceIdentifier';
import { NotFoundHttpError } from '../../util/errors/NotFoundHttpError';
import { BaseFileIdentifierMapper } from './BaseFileIdentifierMapper';
import type { ResourceLink } from './FileIdentifierMapper';
import { getExtension } from '../../util/PathUtil';

export class MultipleFixedContentTypeMapper extends BaseFileIdentifierMapper {
  private readonly extensionTypes: Record<string, string>;
  private readonly searchExtensions: string[];
  private readonly urlSuffix: string;

  public constructor(
    base: string,
    rootFilepath: string,
    extensionTypes?: Record<string, string>,
    searchExtensions?: string[],
    urlSuffix = '',
  ) {
    super(base, rootFilepath);
    this.urlSuffix = urlSuffix;
    
    // Standardize extensions to always start with a dot
    const rawExtensions = searchExtensions ?? ['.nq', '.rq', '.txt'];
    this.searchExtensions = rawExtensions.map(ext => ext.startsWith('.') ? ext : `.${ext}`);

    // Standardize extension types map to always use dotted keys
    this.extensionTypes = {};
    const rawExtensionTypes = extensionTypes ?? {
      '.nq': 'application/n-quads',
      '.nt': 'application/n-triples',
      '.rq': 'application/sparql-query',
      '.txt': 'text/plain'
    };
    for (const [ext, type] of Object.entries(rawExtensionTypes)) {
      const cleanExt = ext.startsWith('.') ? ext : `.${ext}`;
      this.extensionTypes[cleanExt] = type;
    }
  }

  protected async getContentTypeFromPath(filePath: string): Promise<string> {
    const extension = getExtension(filePath).toLowerCase();
    const dottedExtension = `.${extension}`;
    return mime.lookup(extension) ||
      this.extensionTypes[dottedExtension] ||
      await super.getContentTypeFromPath(filePath);
  }

  public async mapUrlToDocumentPath(identifier: ResourceIdentifier, filePath: string, contentType?: string): Promise<ResourceLink> {
    if (this.urlSuffix) {
      if (filePath.endsWith(this.urlSuffix)) {
        filePath = filePath.slice(0, -this.urlSuffix.length);
      } else {
        throw new NotFoundHttpError(`Attempted to access URL ${filePath} without required suffix ${this.urlSuffix}`);
      }
    }

    if (this.isMetadataPath(filePath) || filePath.endsWith('.meta')) {
      return super.mapUrlToDocumentPath(identifier, filePath, contentType);
    }

    if (!contentType) {
      // Handle exact path matches (e.g., explicit /posts.nq requests)
      if (await this.fileExists(filePath)) {
        const resolvedContentType = await this.getContentTypeFromPath(filePath);
        return super.mapUrlToDocumentPath(identifier, filePath, resolvedContentType);
      }

      // Handle extensionless URLs matching either native files or internal CSS files
      for (const extension of this.searchExtensions) {
        const cleanExtension = extension.slice(1);
        
        const pathsToTest = [
          `${filePath}${extension}`,          // Native files (e.g., posts.nq)
          `${filePath}$.${cleanExtension}`    // Internal CSS files (e.g., filter-cset2$.rq)
        ];

        for (const testPath of pathsToTest) {
          if (await this.fileExists(testPath)) {
            const resolvedContentType = await this.getContentTypeFromPath(testPath);
            return super.mapUrlToDocumentPath(identifier, testPath, resolvedContentType);
          }
        }
      }
      
      const defaultContentType = await this.getContentTypeFromPath(filePath);
      return super.mapUrlToDocumentPath(identifier, filePath, defaultContentType);
    }

    const expectedContentType = await this.getContentTypeFromPath(filePath);
    if (contentType !== expectedContentType) {
      let extension = mime.extension(contentType) || 
                      Object.keys(this.extensionTypes).find(k => this.extensionTypes[k] === contentType);
      
      if (!extension) {
        extension = this.unknownMediaTypeExtension;
        contentType = undefined;
      }
      
      // Write missing extensions using the internal identifier syntax
      const cleanExtension = extension.startsWith('.') ? extension.slice(1) : extension;
      filePath += `$.${cleanExtension}`; 
    }

    return super.mapUrlToDocumentPath(identifier, filePath, contentType);
  }

  protected async getDocumentUrl(relative: string): Promise<string> {
    if (!this.isMetadataPath(relative)) {
      // Only strip internal $. prefixes to preserve URL identities of explicit files
      const extension = getExtension(relative);
      if (extension && relative.endsWith(`$.${extension}`)) {
        relative = relative.slice(0, -(extension.length + 2));
      }
    }
    return super.getDocumentUrl(relative + this.urlSuffix);
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await fsPromises.access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}