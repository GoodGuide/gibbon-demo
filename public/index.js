window.GibbonApp = function($, CodeMirror, Gibbon, CoffeeScript) {
  var codeEditor;
  var confEditor;

  var codeElement;
  var confElement;
  var indexElement;
  var valuesElement;
  var errorsElement;
  var catalogElement;

  $(document).ready(function() {
    codeElement = $('#code');
    confElement = $('#conf');
    indexElement = $('#entity-index');
    valuesElement = $('#evaluations .values');
    errorsElement = $('#evaluations .errors');
    catalogElement = $('#catalog');

    setupCodeMirror();
    setupPad();
  });

  function loadConfiguration(source) {
    try {
      var compiled = CoffeeScript.compile('return ('+source+');');
      var object = new Function('t', 'return '+compiled)(Gibbon.Type);
      return Gibbon.jsonConsumer(object);
    }
    catch (e) {
      reportErrors([e.toString()]);
    }
  }

  function loadAST(source) {
    try {
      return Gibbon.parse(source);
    }
    catch (e) {
      reportErrors([e.toString()]);
    }
  }

  function runPad(index, table, conf, source) {
    clearErrors();
    clearValues();

    var conf = loadConfiguration(conf);
    var ast = loadAST('main := ('+source+')');

    if (!ast || !conf) return;

    var result = Gibbon.analyze(ast, table, conf);

    if (result.success) {
      evalGibbon(index, conf, result.semantics, reportEvaluation);
    }
    else {
      reportFailure(result.errors);
    }
  }

  function h(string) {
    return string.replace('&', '&amp;')
      .replace('<', '&lt;')
      .replace('>', '&gt;');
  }

  function inspectableHash(hash, inspectFn) {
    out = '';
    hash.each(function(key, element) {
      // strip off /main
      key = '.' + key.slice(6);

      out += '<li>';
      out += '<span class="key">'+h(key)+'</span>';
      out += '<span class="equals">=</span>';
      out += '<span class="result">'+inspectFn(element)+'</span>';
      out += '</li>';
    });

    return out;
  }

  function inspectDepdendency(dependency) {
    return dependency.cases({
      query: function(id, annotations) {
        return annotations.table+'['+id+']/@'+annotations.name;
      },
      lexical: function(name) {
        return '.' + name.slice(6);
      },
      failure: function(id, annotations) {
        return annotations.table+'['+id+']/@'+annotations.name+' (missing)';
      }
    });
  }

  function reportEvaluation(evaluation) {
    output = inspectableHash(evaluation, function(e) {
      var value = e.value;
      var deps = e.dependencies;

      var ideps = []
      for (var i = 0; i < e.dependencies.length; i += 1) {
        ideps[i] = '<li>'+h(inspectDepdendency(e.dependencies[i]))+'</li>';
      }

      var ivalue = value ? value.inspect() : '(missing)';

      return '<span class="value">'+h(ivalue)+'</span><h4>dependencies:</h4><ul class="dependencies">'+ideps.join(', ')+'</ul>';
    });

    valuesElement.html(output);
  }

  function reportFailure(errors) {
    messages = [];
    for (var i = 0; i < errors.length; i += 1) {
      messages[i] = errors[i].inspect();
    }

    reportErrors(messages);
  }

  function reportErrors(messages) {
    out = '';
    for (var i = 0; i < messages.length; i += 1) {
      out += '<li class="error">' + h(messages[i]) + '</li>';
    }

    errorsElement.append(out);
  }

  function clearErrors() {
    errorsElement.html('');
  }

  function clearValues() {
    valuesElement.html('');
  }

  function evalGibbon(index, conf, semantics, cb) {
    compiled = Gibbon.compile(semantics);

    compiled.run(index, conf, cb);
  }

  function setupCodeMirror() {
    codeEditor = CodeMirror.fromTextArea(codeElement[0], {
      comment: true,
      matchBrackets: true,
      lineNumbers: true,
      mode: 'gibbon',
      tabSize: 2,
      extraKeys: {
        'Ctrl-/': 'toggleComment',
        'Ctrl-Enter': updatePad,
        'Ctrl-Space': function() { confEditor.getTextArea().focus(); }
      }
    });

    confEditor = CodeMirror.fromTextArea(confElement[0], {
      comment: true,
      matchBrackets: true,
      lineNumbers: true,
      mode: 'coffeescript',
      tabSize: 2,
      extraKeys: {
        'Ctrl-/': 'toggleComment',
        'Ctrl-Enter': updatePad,
        'Ctrl-Space': function() { codeEditor.getTextArea().focus(); }
      }
    });
  }

  function updatePad() {
    runPad(+indexElement.val(), catalogElement.val(), confEditor.getValue(), codeEditor.getValue());
  }

  function setupPad() {
    $('#container').on('submit', updatePad);
  }
}(jQuery, CodeMirror, Gibbon, CoffeeScript);
