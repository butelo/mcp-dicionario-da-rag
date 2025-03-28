import axios from 'axios';
import * as cheerio from 'cheerio';
// Interface for word definition
export interface Definition {
  sense?: string;
  definition: string;
  examples: string[];
  references?: {
    type: 'SYNONYM' | 'SEE' | 'COMPARE';
    words: string[];
  };
}

// Interface for Galician dictionary word entry
export interface DictionaryEntry {
  word: string;
  partOfSpeech?: string;
  definitions: Definition[];
  expressions: {
    expression: string;
    definitions: Definition[];
  }[];
}

// Class to interact with the Academia Galega dictionary API
export class GalicianDictionary {
  private baseUrl = 'https://academia.gal/dicionario';
  private headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:136.0) Gecko/20100101 Firefox/136.0',
    'Accept': 'application/json, text/javascript, */*',
    'Accept-Language': 'gl-ES,gl;q=0.8,en-US;q=0.5,en;q=0.3',
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': 'https://academia.gal',
    'Connection': 'keep-alive',
    'Referer': 'https://academia.gal/dicionario',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
  };

  /**
   * Search for a word in the dictionary
   * @param word The word to search for
   * @returns Promise with the parsed dictionary entry or null if not found/error
   */
  async searchWord(word: string): Promise<DictionaryEntry | null> {
    try {
      const params = new URLSearchParams({
        'p_p_id': 'com_ideit_ragportal_liferay_dictionary_NormalSearchPortlet',
        'p_p_lifecycle': '2',
        'p_p_state': 'normal',
        'p_p_mode': 'view',
        'p_p_cacheability': 'cacheLevelPage',
        '_com_ideit_ragportal_liferay_dictionary_NormalSearchPortlet_cmd': 'cmdNormalSearch',
        '_com_ideit_ragportal_liferay_dictionary_NormalSearchPortlet_renderMode': 'load',
        '_com_ideit_ragportal_liferay_dictionary_NormalSearchPortlet_nounTitle': word
      });

      const formData = new URLSearchParams({
        '_com_ideit_ragportal_liferay_dictionary_NormalSearchPortlet_fieldSearchNoun': word
      });

      const response = await axios.post(
        `${this.baseUrl}?${params.toString()}`,
        formData.toString(),
        { headers: this.headers }
      );

      if (response.status !== 200) {
        console.error(`[GalicianDictionary] Error: Received status code ${response.status} for word "${word}"`);
        return null;
      }

      return this.parseResponse(response.data, word); // Pass word for context in case of parsing issues
    } catch (error: any) {
      console.error(`[GalicianDictionary] Error searching word "${word}":`, error.message);
      // Optionally check for specific axios errors (e.g., network error)
      // if (axios.isAxiosError(error)) { ... }
      return null;
    }
  }

  /**
   * Parse the JSON response from the API
   * @param data The response data
   * @param word The searched word (for logging)
   * @returns Parsed dictionary entry or null
   */
  private parseResponse(data: any, word: string): DictionaryEntry | null {
    try {
      if (!data || typeof data !== 'object') {
        console.error(`[GalicianDictionary] Invalid response structure for word "${word}"`);
        return null;
      }
      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
        // This is expected if the word is not found, so don't log as error unless debugging
        // console.log(`[GalicianDictionary] No results found for word "${word}"`);
        return null;
      }

      // Usually the first item is the most relevant exact match
      const item = data.items[0];
      const htmlContent = item?.htmlContent;
      const title = item?.title; // Use the title from the response if available

      if (!htmlContent) {
        console.warn(`[GalicianDictionary] No HTML content found in response item for word "${word}"`);
        return null;
      }

      // Use the title from the response, fallback to the searched word
      const wordTitle = title || word;
      return this.parseHtmlContent(htmlContent, wordTitle);

    } catch (error: any) {
      console.error(`[GalicianDictionary] Error parsing JSON response for word "${word}":`, error.message);
      return null;
    }
  }

  /**
   * Parse the HTML content to extract definitions and expressions
   * @param htmlContent The HTML content
   * @param wordTitle The word title from the response
   * @returns Parsed dictionary entry
   */
  private parseHtmlContent(htmlContent: string, wordTitle: string): DictionaryEntry {
    const $ = cheerio.load(htmlContent);
    const entry: DictionaryEntry = {
      word: wordTitle.trim(), // Use the title from the response HTML structure/API
      definitions: [],
      expressions: []
    };

    // Find the main entry block (adjust selector if needed based on actual HTML)
    const mainEntryBlock = $('.Subentry').first();
    if(mainEntryBlock.length === 0) {
        console.warn(`[GalicianDictionary] Could not find main entry block for "${wordTitle}"`);
        // Attempt parsing without specific block if necessary, or return early
        // return entry; // Might return empty entry
    }

    // Extract word again from H2 if needed, to ensure accuracy, compare with wordTitle
    const h2Word = mainEntryBlock.find('h2.Entry__Word_form').text().trim();
    if (h2Word && h2Word !== entry.word) {
        // console.log(`[GalicianDictionary] Updating word title from "${entry.word}" to "${h2Word}" based on H2 tag.`);
        entry.word = h2Word;
    }


    // Extract part of speech (ensure it's within the main entry context)
    entry.partOfSpeech = mainEntryBlock.find('.Subentry__Part_of_speech').first().text().trim() || undefined;

    // Extract main definitions (within the main entry context)
    mainEntryBlock.find('> .Sense').each((_i, element) => { // Use direct child selector '>'
      const senseNumber = $(element).find('.Sense__SenseNumber').text().trim().replace('.', '');
      const definitionText = $(element).find('.Definition__Definition').first().text().trim(); // Use first() for safety

      if (!definitionText) return; // Skip senses without definition text

      const examples: string[] = [];
      $(element).find('.Example__Example').each((_j, exampleEl) => {
        examples.push($(exampleEl).text().trim());
      });

      // Extract references (synonyms, etc.) for this sense
      const references = this.extractReferences($, element);

      const definition: Definition = {
        sense: senseNumber || undefined,
        definition: definitionText,
        examples,
        references: references.length > 0 ? references[0] : undefined // Assuming max one reference block per sense
      };

      entry.definitions.push(definition);
    });

    // Extract expressions and phrases ("Fraseoloxia")
    // These might be outside the first .Subentry, or nested differently. Adjust selector as needed.
    $('.Fraseoloxia').each((_i, element) => {
      const expressionText = $(element).find('.Fraseoloxia__Texto').first().text().trim();

      // Skip the "Palabras relacionadas" section reliably
      if (expressionText.startsWith('Palabras relacionadas:')) {
        return; // continue to next .Fraseoloxia
      }
       if (!expressionText) {
        return; // skip if no expression text
      }


      const expressionDefinitions: Definition[] = [];

      // Look for senses *within* this specific Fraseoloxia block
      $(element).find('.Subentry .Sense').each((_j, senseEl) => {
        const senseNumber = $(senseEl).find('.Sense__SenseNumber').text().trim().replace('.', '');
        const definitionText = $(senseEl).find('.Definition__Definition').first().text().trim();

        if (!definitionText) return; // Skip senses without definition text

        const examples: string[] = [];
        $(senseEl).find('.Example__Example').each((_k, exampleEl) => {
          examples.push($(exampleEl).text().trim());
        });

        // Extract references for this sense within the expression
        const references = this.extractReferences($, senseEl);

        const definition: Definition = {
          sense: senseNumber || undefined,
          definition: definitionText,
          examples,
          references: references.length > 0 ? references[0] : undefined
        };

        expressionDefinitions.push(definition);
      });

      // Fallback: If no .Sense found, check for direct definitions within the expression's .Subentry
      if (expressionDefinitions.length === 0) {
         $(element).find('.Subentry > .Definition').each((_j, defEl) => { // Direct child Definition
             const definitionText = $(defEl).find('.Definition__Definition').first().text().trim();
             if (definitionText) {
                 const examples: string[] = [];
                 // Examples might be siblings or children differently here
                 $(defEl).siblings('.Example').find('.Example__Example').each((_k, exampleEl) => {
                     examples.push($(exampleEl).text().trim());
                 });
                 // Check for references associated with this definition block
                 const references = this.extractReferences($, $(defEl).parent().get(0)); // Check parent or relevant container

                 expressionDefinitions.push({
                     definition: definitionText,
                     examples,
                     references: references.length > 0 ? references[0] : undefined
                 });
             }
         });
      }


      // Only add expressions that have a valid text and at least one definition
      if (expressionText && expressionDefinitions.length > 0) {
        entry.expressions.push({
          expression: expressionText,
          definitions: expressionDefinitions
        });
      }
    });

     // Basic check: if no definitions and no expressions found, maybe parsing failed?
     if (entry.definitions.length === 0 && entry.expressions.length === 0) {
         // If the HTML wasn't empty, this suggests selectors might be wrong/outdated
         if (htmlContent.length > 50) { // Arbitrary check for non-trivial HTML
            console.warn(`[GalicianDictionary] Parsed entry for "${wordTitle}" is empty despite receiving HTML. Selectors might need review.`);
         }
     }


    return entry;
  }

  /**
   * Extract references (synonyms, see also, etc.) from an element context
   * @param $ Cheerio instance
   * @param contextElement The element (e.g., Sense, Subentry) to search within
   * @returns Array of references found directly within or associated with the context
   */
  private extractReferences($: cheerio.Root, contextElement: cheerio.Element): Array<{
    type: 'SYNONYM' | 'SEE' | 'COMPARE';
    words: string[];
  }> {
    const referencesList: Array<{
      type: 'SYNONYM' | 'SEE' | 'COMPARE';
      words: string[];
    }> = [];

    // Find .References elements *within* the current contextElement
    $(contextElement).find('.References').each((_idx, referencesElement) => {
        const refText = $(referencesElement).children().remove().end().text().trim(); // Get text before the links
        let refType: 'SYNONYM' | 'SEE' | 'COMPARE' | null = null;

        if (refText.startsWith('SINÓNIMO') || refText.startsWith('SINÓNIMOS')) {
        refType = 'SYNONYM';
        } else if (refText.startsWith('VÉXASE')) {
        refType = 'SEE';
        } else if (refText.startsWith('CONFRÓNTESE')) {
        refType = 'COMPARE';
        } else {
         // Try finding the type span directly if text match failed
         const typeSpan = $(referencesElement).find('.Reference__Reference_type').text().trim();
         if (typeSpan.includes('SINÓNIMO')) refType = 'SYNONYM';
         else if (typeSpan.includes('VÉXASE')) refType = 'SEE';
         else if (typeSpan.includes('CONFRÓNTESE')) refType = 'COMPARE';
         else return; // Skip if type cannot be determined
        }

        // Extract reference words (links) within this specific .References block
        const words: string[] = [];
        $(referencesElement).find('a.Reference').each((_i, refEl) => {
          const word = $(refEl).text().trim();
          if (word) words.push(word);
        });

        if (refType && words.length > 0) {
            referencesList.push({
                type: refType,
                words
            });
        }
    });


    return referencesList;
  }

  // --- Removed printEntry method ---
  // We will format the output in the MCP server itself
}

// --- Removed main execution block ---
// This file is now intended to be used as a library module