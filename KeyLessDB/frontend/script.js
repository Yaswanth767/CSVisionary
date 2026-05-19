let csvData = [];

const exclusionTriggers = ['not', 'except', 'without', 'but', 'other than'];
const andOrTriggers = ['and', 'or'];
const numericOperators = ["under", "below", "less than", "above", "over", "greater than", "=", "<", ">", "between", "around", "approx", "near", "about"];

const customSynonyms = {
  price: ["cost", "amount", "rate"],
  name: ["title", "label"],
  age: ["years", "old"],
  category: ["type", "kind", "group"]
};


function levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) =>
    Array.from({ length: a.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
    }
  }
  return matrix[b.length][a.length];
}

function getClosestMatch(word, list, threshold = 0.72) {
  function similarity(a, b) {
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1.0;
    return (longer.length - levenshtein(longer, shorter)) / longer.length;
  }

  let bestMatch = word;
  let maxScore = 0;
  for (const target of list) {
    const score = similarity(word, target);
    if (score > maxScore && score >= threshold) {
      maxScore = score;
      bestMatch = target;
    }
  }
  return bestMatch;
}

function autoCorrectWords(words, vocabulary) {
  return words.map(word => getClosestMatch(word, vocabulary));
}

function expandWithSynonyms(wordList) {
  const expanded = new Set(wordList);
  wordList.forEach(word => {
    for (const [key, synonyms] of Object.entries(customSynonyms)) {
      if (word === key || synonyms.includes(word)) {
        expanded.add(key);
        synonyms.forEach(syn => expanded.add(syn));
      }
    }
  });
  return Array.from(expanded);
}


document.getElementById('csvFile').addEventListener('change', function (e) {
  const file = e.target.files[0];
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: function (results) {
      csvData = results.data;
      console.log('CSV Loaded:', csvData);
      document.getElementById('output').innerHTML = '<p>✅ CSV loaded. Ask your question now.</p>';
    }
  });
});

 
function handleQuery() {
  const question = document.getElementById('questionInput').value.toLowerCase().trim();
  const outputDiv = document.getElementById('output');

  if (!csvData.length) {
    outputDiv.innerHTML = '<p>❌ Please upload a CSV file first.</p>';
    return;
  }

  let filteredData = csvData;

  const vocabulary = new Set();
  csvData.forEach(row => {
    for (const [key, val] of Object.entries(row)) {
      vocabulary.add(key.toLowerCase());
      val?.toString().toLowerCase().split(/\s+/).forEach(token => vocabulary.add(token));
    }
  });

  const allVocab = Array.from(new Set([
    ...vocabulary,
    ...Object.keys(customSynonyms),
    ...Object.values(customSynonyms).flat(),
    ...exclusionTriggers,
    ...andOrTriggers,
    ...numericOperators
  ]));

  const rawWords = question.split(/\s+/);
  const correctedWords = autoCorrectWords(rawWords, allVocab);

  let includeWords = [];
  let excludeWords = [];
  let isExclusion = false;

  for (let i = 0; i < correctedWords.length; i++) {
    const word = correctedWords[i];
    const twoWord = correctedWords.slice(i, i + 2).join(" ");
    if (exclusionTriggers.includes(word) || exclusionTriggers.includes(twoWord)) {
      isExclusion = true;
      if (exclusionTriggers.includes(twoWord)) i++;
      continue;
    }
    (isExclusion ? excludeWords : includeWords).push(word);
  }

  includeWords = expandWithSynonyms(includeWords);
  excludeWords = expandWithSynonyms(excludeWords);
  const betweenPattern = /(?:between)\s+(\d+(?:\.\d+)?)\s*(?:and|-)\s*(\d+(?:\.\d+)?)/gi;
  let match;
  while ((match = betweenPattern.exec(question)) !== null) {
    const min = parseFloat(match[1]);
    const max = parseFloat(match[2]);
    
    const numericColumns = Object.keys(csvData[0]).filter(col =>
      csvData.every(row => {
        const val = parseFloat(row[col]);
        return !isNaN(val);
      })
    );

    filteredData = filteredData.filter(row =>
      numericColumns.some(col => {
        const val = parseFloat(row[col]);
        return !isNaN(val) && val >= min && val <= max;
      })
    );
  }

  
  const numberPatterns = [...question.matchAll(/(\w+)?\s*(under|below|less than|around|approx|near|about|above|over|greater than|>|<|=)?\s*(\d+(\.\d+)?)/g)];
  for (const match of numberPatterns) {
    const word = match[1]?.toLowerCase();
    const operator = match[2]?.toLowerCase();
    const value = parseFloat(match[3]);
    const fuzziness = ["around", "approx", "near", "about"].includes(operator) ? value * 0.1 : 0;

    let matchedColumns = [];

    if (word) {
      const possible = Object.keys(csvData[0]);
      const best = getClosestMatch(word, possible);
      matchedColumns.push(best);
    }

    if (matchedColumns.length === 0) {
      matchedColumns = Object.keys(csvData[0]).filter(col =>
        csvData.every(row => !isNaN(parseFloat(row[col])))
      );
    }

    for (const column of matchedColumns) {
      filteredData = filteredData.filter(row => {
        const num = parseFloat(row[column]);
        if (isNaN(num)) return false;
        if (fuzziness) return Math.abs(num - value) <= fuzziness;
        if (["under", "below", "less than", "<"].includes(operator)) return num < value;
        if (["above", "over", "greater than", ">"].includes(operator)) return num > value;
        return num === value;
      });
    }
  }

   
  if (includeWords.length) {
    filteredData = filteredData.filter(row =>
      includeWords.some(word =>
        Object.values(row).some(val =>
          val.toString().toLowerCase().includes(word)
        )
      )
    );
  }

  if (excludeWords.length) {
    filteredData = filteredData.filter(row =>
      excludeWords.every(word =>
        Object.values(row).every(val =>
          !val.toString().toLowerCase().includes(word)
        )
      )
    );
  }

  
  filteredData = filteredData.map(row => {
    const text = Object.values(row).join(" ").toLowerCase();
    let score = 0;
    includeWords.forEach(word => {
      if (text.includes(word)) score += 1;
    });
    return { ...row, _score: score };
  }).sort((a, b) => b._score - a._score);

  if (!filteredData.length) {
    outputDiv.innerHTML = `<p>🔍 You asked: "${question}"<br>❌ No matching results found.</p>`;
    return;
  }

  renderTable(filteredData, question);
}


function renderTable(data, question) {
  let tableHtml = "<table border='1'><tr>";
  Object.keys(data[0]).forEach(key => {
    if (key !== '_score') tableHtml += `<th>${key}</th>`;
  });
  tableHtml += "</tr>";
  data.forEach(row => {
    tableHtml += "<tr>";
    Object.entries(row).forEach(([key, value]) => {
      if (key !== '_score') tableHtml += `<td>${value}</td>`;
    });
    tableHtml += "</tr>";
  });
  tableHtml += "</table>";

  const exportButton = `<button onclick="exportCSV()">📁 Export CSV</button>`;
  document.getElementById('output').innerHTML = `<p>🔍 You asked: "${question}"</p>` + exportButton + tableHtml;
}

function exportCSV() {
  const headers = Object.keys(csvData[0]).filter(h => h !== '_score');
  const csvRows = [headers.join(',')];
  csvData.forEach(row => {
    const values = headers.map(h => row[h]);
    csvRows.push(values.join(','));
  });
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'filtered_results.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
