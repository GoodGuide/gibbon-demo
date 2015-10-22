var Gibbon = (function(undefined) {
// pass
var Parsimmon = {};

Parsimmon.Parser = (function() {
  "use strict";

  // The Parser object is a wrapper for a parser function.
  // Externally, you use one to parse a string by calling
  //   var result = SomeParser.parse('Me Me Me! Parse Me!');
  // You should never call the constructor, rather you should
  // construct your Parser from the base parsers and the
  // parser combinator methods.
  function Parser(action) {
    if (!(this instanceof Parser)) return new Parser(action);
    this._ = action;
  };

  var _ = Parser.prototype;

  function makeSuccess(index, value) {
    return {
      status: true,
      index: index,
      value: value,
      furthest: -1,
      expected: []
    };
  }

  function makeFailure(index, expected) {
    return {
      status: false,
      index: -1,
      value: null,
      furthest: index,
      expected: [expected]
    };
  }

  function mergeReplies(result, last) {
    if (!last) return result;
    if (result.furthest > last.furthest) return result;

    var expected = (result.furthest === last.furthest)
      ? result.expected.concat(last.expected)
      : last.expected;

    return {
      status: result.status,
      index: result.index,
      value: result.value,
      furthest: last.furthest,
      expected: expected
    }
  }

  function assertParser(p) {
    if (!(p instanceof Parser)) throw new Error('not a parser: '+p);
  }

  function formatExpected(expected) {
    if (expected.length === 1) return expected[0];

    return 'one of ' + expected.join(', ')
  }

  function formatGot(stream, error) {
    var i = error.index;

    if (i === stream.length) return ', got the end of the stream'


    var prefix = (i > 0 ? "'..." : "'");
    var suffix = (stream.length - i > 12 ? "...'" : "'");

    return ' at character ' + i + ', got ' + prefix + stream.slice(i, i+12) + suffix
  }

  var formatError = Parsimmon.formatError = function(stream, error) {
    console.log('formatError', stream, error);
    return 'expected ' + formatExpected(error.expected) + formatGot(stream, error)
  };

  _.parse = function(stream) {
    var result = this.skip(eof)._(stream, 0);

    return result.status ? {
      status: true,
      value: result.value
    } : {
      status: false,
      index: result.furthest,
      expected: result.expected
    };
  };

  // [Parser a] -> Parser [a]
  var seq = Parsimmon.seq = function() {
    var parsers = [].slice.call(arguments);
    var numParsers = parsers.length;

    return Parser(function(stream, i) {
      var result;
      var accum = new Array(numParsers);

      for (var j = 0; j < numParsers; j += 1) {
        result = mergeReplies(parsers[j]._(stream, i), result);
        if (!result.status) return result;
        accum[j] = result.value
        i = result.index;
      }

      return mergeReplies(makeSuccess(i, accum), result);
    });
  };


  var seqMap = Parsimmon.seqMap = function() {
    var args = [].slice.call(arguments);
    var mapper = args.pop();
    return seq.apply(null, args).map(function(results) {
      return mapper.apply(null, results);
    });
  };

  /**
   * Allows to add custom primitive parsers
   */
  var custom = Parsimmon.custom = function(parsingFunction) {
    return Parser(parsingFunction(makeSuccess, makeFailure));
  };

  var alt = Parsimmon.alt = function() {
    var parsers = [].slice.call(arguments);
    var numParsers = parsers.length;
    if (numParsers === 0) return fail('zero alternates')

    return Parser(function(stream, i) {
      var result;
      for (var j = 0; j < parsers.length; j += 1) {
        result = mergeReplies(parsers[j]._(stream, i), result);
        if (result.status) return result;
      }
      return result;
    });
  };

  // -*- primitive combinators -*- //
  _.or = function(alternative) {
    return alt(this, alternative);
  };

  _.then = function(next) {
    if (typeof next === 'function') {
      throw new Error('chaining features of .then are no longer supported, use .chain instead');
    }

    assertParser(next);
    return seq(this, next).map(function(results) { return results[1]; });
  };

  // -*- optimized iterative combinators -*- //
  // equivalent to:
  // _.many = function() {
  //   return this.times(0, Infinity);
  // };
  // or, more explicitly:
  // _.many = function() {
  //   var self = this;
  //   return self.then(function(x) {
  //     return self.many().then(function(xs) {
  //       return [x].concat(xs);
  //     });
  //   }).or(succeed([]));
  // };
  _.many = function() {
    var self = this;

    return Parser(function(stream, i) {
      var accum = [];
      var result;
      var prevResult;

      for (;;) {
        result = mergeReplies(self._(stream, i), result);

        if (result.status) {
          i = result.index;
          accum.push(result.value);
        }
        else {
          return mergeReplies(makeSuccess(i, accum), result);
        }
      }
    });
  };

  // equivalent to:
  // _.times = function(min, max) {
  //   if (arguments.length < 2) max = min;
  //   var self = this;
  //   if (min > 0) {
  //     return self.then(function(x) {
  //       return self.times(min - 1, max - 1).then(function(xs) {
  //         return [x].concat(xs);
  //       });
  //     });
  //   }
  //   else if (max > 0) {
  //     return self.then(function(x) {
  //       return self.times(0, max - 1).then(function(xs) {
  //         return [x].concat(xs);
  //       });
  //     }).or(succeed([]));
  //   }
  //   else return succeed([]);
  // };
  _.times = function(min, max) {
    if (arguments.length < 2) max = min;
    var self = this;

    return Parser(function(stream, i) {
      var accum = [];
      var start = i;
      var result;
      var prevResult;

      for (var times = 0; times < min; times += 1) {
        result = self._(stream, i);
        prevResult = mergeReplies(result, prevResult);
        if (result.status) {
          i = result.index;
          accum.push(result.value);
        }
        else return prevResult;
      }

      for (; times < max; times += 1) {
        result = self._(stream, i);
        prevResult = mergeReplies(result, prevResult);
        if (result.status) {
          i = result.index;
          accum.push(result.value);
        }
        else break;
      }

      return mergeReplies(makeSuccess(i, accum), prevResult);
    });
  };

  // -*- higher-level combinators -*- //
  _.result = function(res) { return this.map(function(_) { return res; }); };
  _.atMost = function(n) { return this.times(0, n); };
  _.atLeast = function(n) {
    var self = this;
    return seqMap(this.times(n), this.many(), function(init, rest) {
      return init.concat(rest);
    });
  };

  _.map = function(fn) {
    var self = this;
    return Parser(function(stream, i) {
      var result = self._(stream, i);
      if (!result.status) return result;
      return mergeReplies(makeSuccess(result.index, fn(result.value)), result);
    });
  };

  _.skip = function(next) {
    return seq(this, next).map(function(results) { return results[0]; });
  };

  _.mark = function() {
    return seqMap(index, this, index, function(start, value, end) {
      return { start: start, value: value, end: end };
    });
  };

  _.desc = function(expected) {
    var self = this;
    return Parser(function(stream, i) {
      var reply = self._(stream, i);
      if (!reply.status) reply.expected = [expected];
      return reply;
    });
  };

  // -*- primitive parsers -*- //
  var string = Parsimmon.string = function(str) {
    var len = str.length;
    var expected = "'"+str+"'";

    return Parser(function(stream, i) {
      var head = stream.slice(i, i+len);

      if (head === str) {
        return makeSuccess(i+len, head);
      }
      else {
        return makeFailure(i, expected);
      }
    });
  };

  var regex = Parsimmon.regex = function(re, group) {
    var anchored = RegExp('^(?:'+re.source+')', (''+re).slice((''+re).lastIndexOf('/')+1));
    var expected = '' + re;
    if (group == null) group = 0;

    return Parser(function(stream, i) {
      var match = anchored.exec(stream.slice(i));

      if (match) {
        var fullMatch = match[0];
        var groupMatch = match[group];
        if (groupMatch != null) return makeSuccess(i+fullMatch.length, groupMatch);
      }

      return makeFailure(i, expected);
    });
  };

  var succeed = Parsimmon.succeed = function(value) {
    return Parser(function(stream, i) {
      return makeSuccess(i, value);
    });
  };

  var fail = Parsimmon.fail = function(expected) {
    return Parser(function(stream, i) { return makeFailure(i, expected); });
  };

  var letter = Parsimmon.letter = regex(/[a-z]/i).desc('a letter')
  var letters = Parsimmon.letters = regex(/[a-z]*/i)
  var digit = Parsimmon.digit = regex(/[0-9]/).desc('a digit');
  var digits = Parsimmon.digits = regex(/[0-9]*/)
  var whitespace = Parsimmon.whitespace = regex(/\s+/).desc('whitespace');
  var optWhitespace = Parsimmon.optWhitespace = regex(/\s*/);

  var any = Parsimmon.any = Parser(function(stream, i) {
    if (i >= stream.length) return makeFailure(i, 'any character');

    return makeSuccess(i+1, stream.charAt(i));
  });

  var all = Parsimmon.all = Parser(function(stream, i) {
    return makeSuccess(stream.length, stream.slice(i));
  });

  var eof = Parsimmon.eof = Parser(function(stream, i) {
    if (i < stream.length) return makeFailure(i, 'EOF');

    return makeSuccess(i, null);
  });

  var test = Parsimmon.test = function(predicate) {
    return Parser(function(stream, i) {
      var char = stream.charAt(i);
      if (i < stream.length && predicate(char)) {
        return makeSuccess(i+1, char);
      }
      else {
        return makeFailure(i, 'a character matching '+predicate);
      }
    });
  };

  var oneOf = Parsimmon.oneOf = function(str) {
    return test(function(ch) { return str.indexOf(ch) >= 0; });
  };

  var noneOf = Parsimmon.noneOf = function(str) {
    return test(function(ch) { return str.indexOf(ch) < 0; });
  };

  var takeWhile = Parsimmon.takeWhile = function(predicate) {
    return Parser(function(stream, i) {
      var j = i;
      while (j < stream.length && predicate(stream.charAt(j))) j += 1;
      return makeSuccess(j, stream.slice(i, j));
    });
  };

  var lazy = Parsimmon.lazy = function(desc, f) {
    if (arguments.length < 2) {
      f = desc;
      desc = undefined;
    }

    var parser = Parser(function(stream, i) {
      parser._ = f()._;
      return parser._(stream, i);
    });

    if (desc) parser = parser.desc(desc)

    return parser;
  };

  var index = Parsimmon.index = Parser(function(stream, i) {
    return makeSuccess(i, i);
  });

  //- fantasyland compat

  //- Monoid (Alternative, really)
  _.concat = _.or;
  _.empty = fail('empty')

  //- Applicative
  _.of = Parser.of = Parsimmon.of = succeed

  _.ap = function(other) {
    return seqMap(this, other, function(f, x) { return f(x); })
  };

  //- Monad
  _.chain = function(f) {
    var self = this;
    return Parser(function(stream, i) {
      var result = self._(stream, i);
      if (!result.status) return result;
      var nextParser = f(result.value);
      return mergeReplies(nextParser._(stream, result.index), result);
    });
  };

  return Parser;
})();
// pass
// Generated by CoffeeScript 1.6.3
var AST, CompiledCode, Core, DEBUG, Dependency, Failure, Gibbon, Hash, JS, List, Map, ObjHash, RVal, Result, Ruby, Semantic, Step, Thunk, Trace, Type, TypeAST, TypeExpr, TypeLookup, Value, VarTrace, Variant, analyze, applyOp1, applyOp2, asyncMap, contIter, contMap, equalArrays, eval_, inspectNative, isArray, nameGen, parse, stdlib, uniq, _ref, _ref1, _ref10, _ref11, _ref12, _ref13, _ref14, _ref15, _ref16, _ref17, _ref18, _ref19, _ref2, _ref3, _ref4, _ref5, _ref6, _ref7, _ref8, _ref9,
  __slice = [].slice,
  __hasProp = {}.hasOwnProperty,
  __extends = function(child, parent) { for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

Gibbon = {};

Thunk = (function() {
  Thunk.trampoline = function(t) {
    while (t instanceof Thunk) {
      t = t.run();
    }
    return t;
  };

  function Thunk(run) {
    this.run = run;
  }

  return Thunk;

})();

inspectNative = function(o) {
  switch (typeof o) {
    case 'string':
      return "\"" + o + "\"";
    case 'number':
      return "" + o;
    case 'boolean':
      if (o) {
        return '#t';
      } else {
        return '#f';
      }
    default:
      return "#<" + (typeof o) + " " + o + ">";
  }
};









isArray = Array.isArray || function(arg) {
  return Object.prototype.toString.call(arg) === '[object Array]';
};

equalArrays = function(a1, a2) {
  var e, i, _i, _len;
  for (i = _i = 0, _len = a1.length; _i < _len; i = ++_i) {
    e = a1[i];
    if (e !== a2[i]) {
      return false;
    }
  }
  return true;
};

applyOp1 = function(op, arg) {
  switch (op) {
    case '!':
      return !arg;
    case '-':
      return -arg;
    default:
      throw "unknown operator " + op;
  }
};

applyOp2 = function(op, l, r) {
  switch (op) {
    case '+':
      return l + r;
    case '*':
      return l * r;
    case '/':
      return l / r;
    case '%':
      return l % r;
    case '===':
      return l === r;
    case '<':
      return l < r;
    case '>':
      return l > r;
    case '<=':
      return l <= r;
    case '>=':
      return l >= r;
    default:
      throw "unknown operator " + op;
  }
};

uniq = function(list, eq) {
  var el, isUniq, out, u, _i, _j, _len, _len1;
  if (eq == null) {
    eq = (function(x, y) {
      return x === y;
    });
  }
  if (list.length === 0) {
    return list;
  }
  out = [];
  for (_i = 0, _len = list.length; _i < _len; _i++) {
    el = list[_i];
    isUniq = true;
    for (_j = 0, _len1 = out.length; _j < _len1; _j++) {
      u = out[_j];
      if (eq(el, u)) {
        isUniq = false;
        break;
      }
    }
    if (isUniq) {
      out.push(el);
    }
  }
  return out;
};

asyncMap = function(list, mapper, cb) {
  var el, i, output, response, retVal, seen, _i, _len;
  if (list.length === 0) {
    return cb(list);
  }
  seen = 0;
  output = [];
  retVal = null;
  response = function(i) {
    return function(el) {
      seen += 1;
      output[i] = el;
      if (seen >= list.length) {
        retVal = cb(output);
      }
      return null;
    };
  };
  for (i = _i = 0, _len = list.length; _i < _len; i = ++_i) {
    el = list[i];
    mapper(el, response(i), i);
  }
  return retVal;
};

contMap = function(list, mapper, cb) {
  var accum, step;
  accum = [];
  step = function(el, i, next) {
    return mapper(el, function(result) {
      accum[i] = result;
      return next();
    });
  };
  return contIter(list, step, function() {
    return cb(accum);
  });
};

contIter = function(list, f, cb) {
  var loop_;
  return (loop_ = function(i) {
    if (i >= list.length) {
      return cb();
    }
    return f(list[i], i, function() {
      return loop_(i + 1);
    });
  })(0);
};

Variant = (function() {
  var allocate, castJSON;

  allocate = Object.create || function(proto) {
    var dummy;
    dummy = (function() {});
    dummy.prototype = proto;
    return new dummy;
  };

  Variant.prototype.__isVariant__ = true;

  Variant.specialize = function(tag, names) {
    var klass, name, subclass, _i, _len;
    klass = this;
    subclass = function(values) {
      if (values.length !== names.length) {
        throw new TypeError("wrong number of arguments: " + values.length + " for " + names.length);
      }
      klass.call(this, names, values);
      return this;
    };
    subclass.prototype = allocate(klass.prototype);
    subclass.prototype._tag = tag;
    for (_i = 0, _len = names.length; _i < _len; _i++) {
      name = names[_i];
      subclass.prototype[name] = null;
    }
    return function() {
      var values;
      values = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
      return new subclass(values);
    };
  };

  Variant.variants = function(tagSpec) {
    var names, tag, _results;
    this.prototype._type = this.name;
    this.tags = tagSpec;
    _results = [];
    for (tag in tagSpec) {
      if (!__hasProp.call(tagSpec, tag)) continue;
      names = tagSpec[tag];
      _results.push(this[tag] = this.specialize(tag, names));
    }
    return _results;
  };

  function Variant(_names, _values) {
    var i, name, _i, _len, _ref;
    this._names = _names;
    this._values = _values;
    _ref = this._names;
    for (i = _i = 0, _len = _ref.length; _i < _len; i = ++_i) {
      name = _ref[i];
      this[name] = this._values[i];
    }
  }

  Variant.prototype.cases = function(cases) {
    var fn;
    fn = cases[this._tag] || cases.other;
    if (!fn) {
      throw new Error("non-exhaustive cases: missing " + this._tag);
    }
    return fn.apply(this, this._values);
  };

  castJSON = function(val) {
    var v, _i, _len, _results;
    if (typeof (val != null ? val.asJSON : void 0) === 'function') {
      return val.asJSON();
    } else if (isArray(val)) {
      _results = [];
      for (_i = 0, _len = val.length; _i < _len; _i++) {
        v = val[_i];
        _results.push(castJSON(v));
      }
      return _results;
    } else {
      return val;
    }
  };

  Variant.prototype.asJSON = function() {
    var name, out, _i, _len, _ref;
    out = {
      __isVariant__: true,
      _tag: this._tag,
      _type: this.constructor.name
    };
    _ref = this._names;
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
      name = _ref[_i];
      out[name] = castJSON(this[name]);
    }
    return out;
  };

  Variant.fromJSON = function(o) {
    var constructor, e, name, names, vals;
    if (isArray(o)) {
      return (function() {
        var _i, _len, _results;
        _results = [];
        for (_i = 0, _len = o.length; _i < _len; _i++) {
          e = o[_i];
          _results.push(this.fromJSON(e));
        }
        return _results;
      }).call(this);
    }
    if (!(typeof o === 'object' && (o != null) && '_tag' in o)) {
      return o;
    }
    constructor = Gibbon[o._type];
    names = constructor.tags[o._tag];
    vals = (function() {
      var _i, _len, _results;
      _results = [];
      for (_i = 0, _len = names.length; _i < _len; _i++) {
        name = names[_i];
        _results.push(constructor.fromJSON(o[name]));
      }
      return _results;
    })();
    return constructor[o._tag].apply(constructor, vals);
  };

  Variant.wrap = function(o) {
    if (o instanceof this) {
      return o;
    }
    return this.fromJSON(o);
  };

  return Variant;

})();

List = (function(_super) {
  __extends(List, _super);

  function List() {
    _ref = List.__super__.constructor.apply(this, arguments);
    return _ref;
  }

  List.variants({
    empty: [],
    cons: ['head', 'tail']
  });

  List.single = function(el) {
    return List.empty().cons(el);
  };

  List.prototype.cons = function(el) {
    return List.cons(el, this);
  };

  List.prototype.toArray = function() {
    return this.mapArray(function(x) {
      return x;
    });
  };

  List.prototype.mapArray = function(f) {
    var cursor, out;
    out = [];
    cursor = this;
    while (cursor._tag === 'cons') {
      out.push(f(cursor.head));
      cursor = cursor.tail;
    }
    return out;
  };

  return List;

})(Variant);

Map = (function() {
  function Map() {}

  Map.prototype.has = function() {
    throw 'abstract';
  };

  Map.prototype.get = function() {
    throw 'abstract';
  };

  Map.prototype.set = function() {
    throw 'abstract';
  };

  Map.prototype.each = function() {
    throw 'abstract';
  };

  Map.prototype.fetch = function(k, f) {
    if (this.has(k)) {
      return this.get(k);
    } else {
      return f();
    }
  };

  Map.prototype.merge = function() {
    var k, obj, objs, v, _i, _len, _results;
    objs = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
    _results = [];
    for (_i = 0, _len = objs.length; _i < _len; _i++) {
      obj = objs[_i];
      _results.push((function() {
        var _results1;
        _results1 = [];
        for (k in obj) {
          if (!__hasProp.call(obj, k)) continue;
          v = obj[k];
          _results1.push(this.set(k, v));
        }
        return _results1;
      }).call(this));
    }
    return _results;
  };

  Map.prototype.modify = function(k, f) {
    return this.set(k, f(this.get(k)));
  };

  Map.prototype.cache = function(k, f) {
    var _this = this;
    return this.fetch(k, function() {
      return _this.modify(k, f);
    });
  };

  Map.prototype.size = function() {
    var out;
    out = 0;
    this.each(function() {
      return out += 1;
    });
    return out;
  };

  Map.prototype.keys = function() {
    var out;
    out = [];
    this.each(function(k, v) {
      return out.push(k);
    });
    return out;
  };

  Map.prototype.values = function() {
    var out;
    out = [];
    this.each(function(k, v) {
      return out.push(v);
    });
    return out;
  };

  Map.prototype.eachAsync = function(f, cb) {
    var isAsync, output, remaining, responder;
    output = null;
    remaining = this.size();
    responder = function(k) {
      return function() {
        remaining -= 1;
        if (remaining <= 0) {
          return output = cb();
        }
      };
    };
    this.each(function(k, v) {
      return f(k, v, responder(k));
    });
    isAsync = true;
    return output;
  };

  return Map;

})();

Gibbon.Hash = Hash = (function(_super) {
  var salt, saltLen;

  __extends(Hash, _super);

  function Hash() {
    _ref1 = Hash.__super__.constructor.apply(this, arguments);
    return _ref1;
  }

  Hash.prototype.__isHash__ = true;

  salt = '<key>';

  saltLen = salt.length;

  Hash.prototype.get = function(k) {
    return this[salt + k];
  };

  Hash.prototype.set = function(k, v) {
    return this[salt + k] = v;
  };

  Hash.prototype.has = function(k) {
    return this.hasOwnProperty(salt + k);
  };

  Hash.prototype.each = function(f) {
    var k, v, _results;
    _results = [];
    for (k in this) {
      if (!__hasProp.call(this, k)) continue;
      v = this[k];
      if (k.indexOf(salt) === 0) {
        _results.push(f(k.slice(saltLen), v));
      }
    }
    return _results;
  };

  return Hash;

})(Map);

Gibbon.ObjHash = ObjHash = (function(_super) {
  __extends(ObjHash, _super);

  function ObjHash() {
    _ref2 = ObjHash.__super__.constructor.apply(this, arguments);
    return _ref2;
  }

  ObjHash.prototype.get = function(k) {
    var _ref3;
    return (_ref3 = this[k.hash()]) != null ? _ref3.value : void 0;
  };

  ObjHash.prototype.set = function(k, v) {
    this[k.hash()] = {
      key: k,
      value: v
    };
    return v;
  };

  ObjHash.prototype.has = function(k) {
    return this.hasOwnProperty(k.hash());
  };

  ObjHash.prototype.each = function(f) {
    var k, v, _results;
    _results = [];
    for (k in this) {
      if (!__hasProp.call(this, k)) continue;
      v = this[k];
      _results.push(f(v.key, v.value));
    }
    return _results;
  };

  return ObjHash;

})(Map);

Gibbon.AST = AST = (function(_super) {
  var inspectDefinitions;

  __extends(AST, _super);

  function AST() {
    _ref3 = AST.__super__.constructor.apply(this, arguments);
    return _ref3;
  }

  AST.variants({
    integer: ['loc', 'value'],
    decimal: ['loc', 'value'],
    percent: ['loc', 'value'],
    fraction: ['loc', 'numerator', 'denominator'],
    string: ['loc', 'value'],
    subst: ['loc', 'flow'],
    block: ['loc', 'flow'],
    list: ['loc', 'elements', 'squish'],
    defaulted: ['loc', 'body', 'alternative'],
    query: ['loc', 'type', 'args'],
    lexical: ['loc', 'name', 'args'],
    func: ['loc', 'name', 'args'],
    pair: ['loc', 'first', 'second'],
    flow: ['loc', 'head', 'tail'],
    metadata: ['loc', 'key', 'text'],
    definition: ['loc', 'metadata', 'name', 'frame'],
    frame: ['loc', 'definitions', 'flow'],
    program: ['definitions']
  });

  inspectDefinitions = function(defs) {
    var def, out, _i, _len;
    out = [];
    for (_i = 0, _len = defs.length; _i < _len; _i++) {
      def = defs[_i];
      out.push(def.inspect());
      out.push("\n");
    }
    return out.join('');
  };

  AST.prototype.hash = function() {
    return "" + this.loc.start + "-" + this.loc.end;
  };

  AST.prototype.inspect = function() {
    var useValue;
    useValue = function(_, x) {
      return x;
    };
    return this.cases({
      integer: useValue,
      decimal: useValue,
      percent: useValue,
      fraction: function(_, num, denom) {
        return "" + num + "/" + denom;
      },
      string: function(_, s) {
        return "'" + s + "'";
      },
      query: function(_, query, args) {
        if (query === 'access') {
          return "@" + args[0];
        } else if (args.length) {
          return "@:" + query + "[" + (args.join(' ')) + "]";
        } else {
          return "@:" + query;
        }
      },
      lexical: function(_, name, args) {
        return "." + name;
      },
      subst: function(_, flow) {
        return "(" + (flow.inspect()) + ")";
      },
      block: function(_, flow) {
        return "{ " + (flow.inspect()) + " }";
      },
      list: function(_, els, squish) {
        var close, el, open;
        open = squish ? '[*' : '[';
        close = squish ? '*]' : ']';
        return "" + open + " " + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = els.length; _i < _len; _i++) {
            el = els[_i];
            _results.push(el.inspect());
          }
          return _results;
        })()).join(', ')) + " " + close;
      },
      defaulted: function(_, body, alt) {
        return "" + (body.inspect()) + " | " + (alt.inspect());
      },
      func: function(_, name, args) {
        var arg;
        args = (function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = args.length; _i < _len; _i++) {
            arg = args[_i];
            if (arg._tag === 'flow' && arg.tail) {
              _results.push("(" + (arg.inspect()) + ")");
            } else {
              _results.push(arg.inspect());
            }
          }
          return _results;
        })();
        return "" + name + " " + (args.join(' '));
      },
      pair: function(_, first, second) {
        return "" + (first.inspect()) + " : " + (second.inspect());
      },
      flow: function(_, head, tail) {
        if (tail) {
          tail = "" + (tail.inspect()) + " -> ";
        } else {
          tail = '';
        }
        return "" + tail + (head.inspect());
      },
      metadata: function(_, key, text) {
        return "+" + key + ": " + text;
      },
      definition: function(_, metadata, name, frame) {
        var m, out, _i, _len;
        out = [];
        for (_i = 0, _len = metadata.length; _i < _len; _i++) {
          m = metadata[_i];
          out.push(m.inspect());
          out.push("\n");
        }
        out.push("" + name + " := ");
        out.push(frame.inspect());
        return out.join('');
      },
      frame: function(_, definitions, flow) {
        var out;
        out = [];
        out.push("(");
        out.push(inspectDefinitions(definitions));
        out.push(flow.inspect());
        out.push(")");
        return out.join('');
      },
      program: function(definitions) {
        return inspectDefinitions(definitions);
      }
    });
  };

  return AST;

})(Variant);

Gibbon.TypeAST = TypeAST = (function(_super) {
  __extends(TypeAST, _super);

  function TypeAST() {
    _ref4 = TypeAST.__super__.constructor.apply(this, arguments);
    return _ref4;
  }

  TypeAST.variants({
    concrete: ['name'],
    variable: ['name'],
    wildcard: [],
    list: ['of'],
    func: ['input', 'args', 'output'],
    block: ['of'],
    pair: ['first', 'second'],
    arrow: ['from', 'to']
  });

  TypeAST.parse = function(str) {
    return parse.type(str);
  };

  return TypeAST;

})(Variant);

parse = Gibbon.parse = (function() {
  var accessor, accessorExpr, arrow, arrowType, assertString, blankLines, blockExpr, blockType, comma, commaSepFlows, comment, component, concrete, decimal, decimalExpr, defaulted, define, definition, expr, fail, flow, fraction, fractionExpr, frame, freeFrame, fullFrame, fullSignature, func, funcPlaceholder, handleResult, identifier, innerFrame, integer, integerExpr, isString, label, labelVal, lazy, lbrace, lbrack, lexeme, lexical, lexicalExpr, lines, listExpr, listType, lparen, lsplat, metadata, multiline, name, nonDefaultedFlow, nonPairedFlow, numericExpr, opt, pair, parenFlow, parenFrame, parenType, percent, percentExpr, program, query, queryArg, queryExpr, rbrace, rbrack, regex, rparen, rsplat, seq, signature, simpleType, singletonFlow, spanLoc, squishListExpr, str, string, stringExpr, substExpr, succeed, tag, tassign, type, typeVar, variable, whitespace, wildType, wildcard, withLoc,
    _this = this;
  tag = function(name, parser) {
    return parser.desc(name);
  };
  Parsimmon.Parser.prototype.tryChain = function(f) {
    return this.chain(function(res) {
      return f(res).or(succeed(res));
    });
  };
  string = Parsimmon.string, regex = Parsimmon.regex, succeed = Parsimmon.succeed, fail = Parsimmon.fail;
  seq = Parsimmon.seq, lazy = Parsimmon.lazy;
  whitespace = tag('inline whitespace', regex(/^[ \t]*/));
  blankLines = regex(/[\n;\s]+/).desc('blank lines');
  comment = regex(/#.*?(\n|$)/).desc('a comment');
  lines = tag('whitespace', (blankLines.or(comment)).many());
  lexeme = function(p) {
    return p.mark().skip(whitespace);
  };
  multiline = function(p) {
    return p.mark().skip(lines);
  };
  opt = function(p) {
    return p.or(succeed(null));
  };
  withLoc = function(p, f) {
    return p.map(function(_arg) {
      var end, start, value;
      start = _arg.start, value = _arg.value, end = _arg.end;
      return f({
        start: start,
        end: end
      }, value);
    });
  };
  spanLoc = function(l, r) {
    return {
      start: l.start,
      end: r.end
    };
  };
  identifier = tag('an identifier', regex(/^[a-z][\w-]*[?]?/i));
  arrow = multiline(string('->'));
  define = multiline(string(':='));
  pair = multiline(string(':'));
  lbrace = multiline(string('{'));
  rbrace = lexeme(string('}'));
  lbrack = multiline(string('['));
  rbrack = lexeme(string(']'));
  lparen = multiline(string('('));
  rparen = lexeme(string(')'));
  comma = multiline(string(','));
  defaulted = multiline(string('|'));
  lsplat = multiline(string('[*'));
  rsplat = lexeme(string('*]'));
  query = lexeme(string('@:').then(identifier).desc('a query'));
  queryArg = lexeme(regex(/^\w[\w-]*/));
  accessor = lexeme(string('@').then(identifier).desc('an accessor'));
  lexical = lexeme(string('.').then(identifier));
  name = lexeme(identifier);
  str = lexeme(string("'").then(regex(/^[^']*/)).skip(string("'")));
  fraction = tag('a fraction', lexeme(regex(/^\d+\/\d+/)));
  decimal = tag('a decimal', lexeme(regex(/^\d+\.\d+/)));
  percent = tag('a percentage', lexeme(regex(/^\d+%/)));
  integer = tag('a number', lexeme(regex(/^\d+/)));
  label = lexeme(string('~').then(identifier.skip(whitespace)).skip(string(':')));
  labelVal = multiline(regex(/[^\n]*/));
  variable = lexeme(string('%').then(identifier));
  wildcard = lexeme(string('%'));
  funcPlaceholder = lexeme(string('&'));
  integerExpr = withLoc(integer, function(loc, i) {
    return AST.integer(loc, parseInt(i));
  });
  decimalExpr = withLoc(decimal, function(loc, d) {
    return AST.decimal(loc, parseFloat(d));
  });
  percentExpr = withLoc(percent, function(loc, p) {
    return AST.percent(loc, parseInt(p));
  });
  fractionExpr = withLoc(fraction, function(loc, f) {
    var denom, num, _ref5;
    _ref5 = f.split('/'), num = _ref5[0], denom = _ref5[1];
    return AST.fraction(loc, num, denom);
  });
  stringExpr = withLoc(str, function(loc, s) {
    return AST.string(loc, s);
  });
  accessorExpr = withLoc(accessor, function(loc, name) {
    return AST.query(loc, 'access', [name]);
  });
  lexicalExpr = withLoc(lexical, function(loc, name) {
    return AST.lexical(loc, name, []);
  });
  queryExpr = query.chain(function(q) {
    var args;
    args = seq(lbrack, queryArg.many(), rbrack).map(function(_arg) {
      var a, args, loc, r, _;
      _ = _arg[0], args = _arg[1], r = _arg[2];
      loc = spanLoc(q, r);
      return AST.query(loc, q.value, (function() {
        var _i, _len, _results;
        _results = [];
        for (_i = 0, _len = args.length; _i < _len; _i++) {
          a = args[_i];
          _results.push(a.value);
        }
        return _results;
      })());
    });
    return args.or(succeed(AST.query(spanLoc(q, q), q.value, [])));
  });
  numericExpr = percentExpr.or(decimalExpr.or(fractionExpr.or(integerExpr)));
  parenFlow = lazy(function() {
    return lparen.then(flow).skip(rparen);
  });
  substExpr = lazy(function() {
    return seq(lparen, flow, rparen).map(function(_arg) {
      var fl, l, r;
      l = _arg[0], fl = _arg[1], r = _arg[2];
      return AST.subst(spanLoc(l, r), fl);
    });
  });
  listExpr = lazy(function() {
    return seq(lbrack, commaSepFlows, rbrack).map(function(_arg) {
      var els, l, r;
      l = _arg[0], els = _arg[1], r = _arg[2];
      return AST.list(spanLoc(l, r), els, false);
    });
  });
  squishListExpr = lazy(function() {
    return seq(lsplat, commaSepFlows, rsplat).map(function(_arg) {
      var els, l, r;
      l = _arg[0], els = _arg[1], r = _arg[2];
      return AST.list(spanLoc(l, r), els, true);
    });
  });
  blockExpr = lazy(function() {
    return seq(lbrace, flow, rbrace).map(function(_arg) {
      var flow, l, r;
      l = _arg[0], flow = _arg[1], r = _arg[2];
      return AST.block(spanLoc(l, r), flow);
    });
  });
  expr = tag('an expr', queryExpr.or(accessorExpr.or(lexicalExpr.or(substExpr.or(squishListExpr.or(listExpr.or(stringExpr.or(blockExpr.or(numericExpr)))))))));
  singletonFlow = expr.map(function(e) {
    return AST.flow(e.loc, e, null);
  });
  func = seq(name, parenFlow.or(singletonFlow).many()).map(function(_arg) {
    var args, loc, name;
    name = _arg[0], args = _arg[1];
    loc = {
      start: name.start,
      end: name.end
    };
    if (args.length) {
      loc.end = args[args.length - 1].loc.end;
    }
    return AST.func(loc, name.value, args);
  });
  component = expr.or(func).skip(lines);
  nonPairedFlow = seq(component, arrow.then(component).many()).map(function(_arg) {
    var comp, cursor, first, rest, _i, _len;
    first = _arg[0], rest = _arg[1];
    cursor = AST.flow(first.loc, first, null);
    for (_i = 0, _len = rest.length; _i < _len; _i++) {
      comp = rest[_i];
      cursor = AST.flow(spanLoc(first.loc, comp.loc), comp, cursor);
    }
    return cursor;
  });
  nonDefaultedFlow = nonPairedFlow.tryChain(function(first) {
    return pair.then(nonDefaultedFlow).map(function(second) {
      var loc;
      loc = spanLoc(first.loc, second.loc);
      return AST.flow(loc, AST.pair(loc, first, second), null);
    });
  });
  flow = tag('a flow', nonDefaultedFlow.tryChain(function(body) {
    return defaulted.then(flow).map(function(alternative) {
      var loc;
      loc = spanLoc(body.loc, alternative.loc);
      return AST.flow(loc, AST.defaulted(loc, body, alternative), null);
    });
  }));
  commaSepFlows = seq(flow.skip(seq(opt(comma, lines))).many(), opt(flow)).map(function(_arg) {
    var els, final;
    els = _arg[0], final = _arg[1];
    if (final) {
      els.push(final);
    }
    return els;
  });
  metadata = seq(label, labelVal).desc('metadata').map(function(_arg) {
    var key, text;
    key = _arg[0], text = _arg[1];
    return AST.metadata(spanLoc(key, text), key.value, text.value);
  });
  definition = lazy(function() {
    return seq(metadata.many(), name, define.then(innerFrame)).map(function(_arg) {
      var fl, loc, md, n, _ref5;
      md = _arg[0], n = _arg[1], fl = _arg[2];
      loc = spanLoc(((_ref5 = md[0]) != null ? _ref5.loc : void 0) || n, fl);
      return AST.definition(loc, md, n.value, fl);
    });
  });
  frame = seq(definition, definition.many(), flow).map(function(_arg) {
    var defs, first, flow, loc, rest;
    first = _arg[0], rest = _arg[1], flow = _arg[2];
    defs = [first].concat(rest);
    loc = spanLoc(first.loc, flow.loc);
    return AST.frame(loc, defs, flow);
  });
  parenFrame = seq(lparen, frame, rparen, lines).map(function(_arg) {
    var fr, l, r, _;
    l = _arg[0], fr = _arg[1], r = _arg[2], _ = _arg[3];
    fr.loc = spanLoc(l, r);
    return fr;
  });
  freeFrame = flow.map(function(fl) {
    return AST.frame(fl.loc, [], fl);
  });
  innerFrame = parenFrame.or(freeFrame);
  program = lines.then(definition.many()).map(function(ds) {
    return AST.program(ds);
  });
  fullFrame = lines.then(frame.or(flow));
  tassign = lexeme(string('='));
  concrete = name.map(function(n) {
    return TypeAST.concrete(n.value);
  });
  typeVar = variable.map(function(v) {
    return TypeAST.variable(v.value);
  });
  wildType = wildcard.result(TypeAST.wildcard());
  listType = lazy(function() {
    return seq(lbrack, type, rbrack).map(function(_arg) {
      var t, _, __;
      _ = _arg[0], t = _arg[1], __ = _arg[2];
      return TypeAST.list(t);
    });
  });
  parenType = lazy(function() {
    return lparen.then(type).skip(rparen);
  });
  blockType = lazy(function() {
    return lbrace.then(arrowType).skip(rbrace).map(function(t) {
      return TypeAST.block(t);
    });
  });
  simpleType = typeVar.or(wildType.or(listType.or(parenType.or(blockType.or(concrete)))));
  type = simpleType.tryChain(function(first) {
    return pair.then(type).map(function(second) {
      return TypeAST.pair(first, second);
    });
  });
  arrowType = seq(type, arrow, type).map(function(_arg) {
    var first, second, _;
    first = _arg[0], _ = _arg[1], second = _arg[2];
    return TypeAST.arrow(first, second);
  });
  signature = seq(name, type.many(), tassign.then(arrowType)).map(function(_arg) {
    var argTypes, ftype, name;
    name = _arg[0], argTypes = _arg[1], ftype = _arg[2];
    return TypeAST.func(ftype.from, argTypes, ftype.to);
  });
  fullSignature = lines.then(signature);
  isString = function(s) {
    return typeof s === 'string' || s instanceof String;
  };
  assertString = function(s) {
    if (!isString(s)) {
      throw 'can only parse strings';
    }
  };
  handleResult = function(str, result) {
    if (result.status) {
      return result.value;
    } else {
      throw new Error(Parsimmon.formatError(str, result));
    }
  };
  parse = function(str) {
    assertString(str);
    return handleResult(str, program.parse(str));
  };
  parse.frame = function(str) {
    return handleResult(str, fullFrame.parse(str));
  };
  parse.type = function(str) {
    assertString(str);
    return handleResult(str, fullSignature.parse(str));
  };
  return parse;
})();

Gibbon.Semantic = Semantic = (function(_super) {
  __extends(Semantic, _super);

  function Semantic() {
    _ref5 = Semantic.__super__.constructor.apply(this, arguments);
    return _ref5;
  }

  Semantic.variants({
    definition: ['dependencies', 'flow', 'metadata'],
    literal: ['syntax'],
    query: ['annotations'],
    localAccessor: ['name'],
    pair: ['first', 'second'],
    block: ['body'],
    list: ['elements', 'squish'],
    flow: ['type', 'head', 'tail'],
    func: ['name', 'args', 'scope'],
    subst: ['flow'],
    defaulted: ['body', 'alternative']
  });

  Semantic.prototype.inspect = function() {
    return this.cases({
      definition: function(deps, flow) {
        var d;
        return "<" + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = deps.length; _i < _len; _i++) {
            d = deps[_i];
            _results.push(d.inspect());
          }
          return _results;
        })()).join(', ')) + "> " + (flow.inspect());
      },
      literal: function(syntax) {
        return syntax.inspect();
      },
      query: function(annotations) {
        return "(? " + (JSON.stringify(annotations)) + ")";
      },
      localAccessor: function(name) {
        return "@" + name;
      },
      pair: function(first, second) {
        return "(" + (first.inspect()) + " : " + (second.inspect()) + ")";
      },
      block: function(body) {
        return "{ " + (body.inspect()) + " }";
      },
      list: function(elements, squish) {
        var e, l, r;
        if (squish) {
          l = "[*";
          r = "*]";
        } else {
          l = "[";
          r = "]";
        }
        return "" + l + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = elements.length; _i < _len; _i++) {
            e = elements[_i];
            _results.push(e.inspect());
          }
          return _results;
        })()).join(', ')) + r;
      },
      flow: function(type, head, tail) {
        if (tail) {
          return "" + (tail.inspect()) + " -> " + (head.inspect()) + " :: " + (type.inspect());
        } else {
          return "" + (head.inspect()) + " :: " + (type.inspect());
        }
      },
      func: function(name, args, scope) {
        var a;
        return "" + name + " " + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = args.length; _i < _len; _i++) {
            a = args[_i];
            _results.push("(" + (a.inspect()) + ")");
          }
          return _results;
        })()).join(' '));
      },
      subst: function(flow) {
        return flow.inspect();
      },
      defaulted: function(body, alt) {
        return "" + (body.inspect()) + " | " + (alt.inspect());
      }
    });
  };

  return Semantic;

})(Variant);

Gibbon.TypeLookup = TypeLookup = (function(_super) {
  __extends(TypeLookup, _super);

  function TypeLookup() {
    _ref6 = TypeLookup.__super__.constructor.apply(this, arguments);
    return _ref6;
  }

  TypeLookup.variants({
    response: ['query', 'analysis'],
    local: ['name'],
    error: ['error']
  });

  TypeLookup.prototype.inspect = function() {
    return this.cases({
      response: function(query, analysis) {
        return "" + (query.inspect()) + (JSON.stringify(analysis.annotations)) + "::" + (analysis.type.inspect());
      },
      local: function(name) {
        return "@" + name;
      },
      error: function(e) {
        return "!" + e;
      }
    });
  };

  return TypeLookup;

})(Variant);

Gibbon.Type = Type = (function(_super) {
  __extends(Type, _super);

  function Type() {
    _ref7 = Type.__super__.constructor.apply(this, arguments);
    return _ref7;
  }

  Type.variants({
    block: ['from', 'to'],
    pair: ['first', 'second'],
    list: ['of'],
    entity: ['id'],
    numeric: [],
    string: [],
    bool: [],
    abstract: ['expr']
  });

  Type.prototype.inspect = function() {
    var recurse;
    return (recurse = function(sexpr) {
      var e;
      if (isArray(sexpr)) {
        return "(" + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = sexpr.length; _i < _len; _i++) {
            e = sexpr[_i];
            _results.push(recurse(e));
          }
          return _results;
        })()).join(' ')) + ")";
      } else {
        return '' + sexpr;
      }
    })(this.toSexpr());
  };

  Type.prototype.toSexpr = function() {
    return this.cases({
      entity: function(id) {
        return ['entity', id];
      },
      other: function() {
        var v;
        return [this._tag].concat(__slice.call((function() {
            var _i, _len, _ref8, _results;
            _ref8 = this._values;
            _results = [];
            for (_i = 0, _len = _ref8.length; _i < _len; _i++) {
              v = _ref8[_i];
              _results.push(v.toSexpr());
            }
            return _results;
          }).call(this)));
      }
    });
  };

  Type.fromSexpr = function(arr) {
    var a, args, tag;
    tag = arr[0];
    if (tag === 'entity') {
      return Type.entity(arr[1]);
    }
    args = (function() {
      var _i, _len, _ref8, _results;
      _ref8 = arr.slice(1);
      _results = [];
      for (_i = 0, _len = _ref8.length; _i < _len; _i++) {
        a = _ref8[_i];
        _results.push(Type.fromSexpr(a));
      }
      return _results;
    })();
    return Type[tag].apply(Type, args);
  };

  return Type;

})(Variant);

Gibbon.TypeExpr = TypeExpr = (function(_super) {
  var uniqError;

  __extends(TypeExpr, _super);

  function TypeExpr() {
    _ref8 = TypeExpr.__super__.constructor.apply(this, arguments);
    return _ref8;
  }

  TypeExpr.variants({
    expr: ['expr'],
    variable: ['name', 'uniq'],
    query: ['input', 'scope', 'query'],
    lexical: ['syntax', 'scope'],
    "native": ['id'],
    param: ['name', 'constraints'],
    destructure: ['constraint', 'name', 'argnum'],
    error: ['type', 'args'],
    any: []
  });

  TypeExpr.prototype.realize = function() {
    return this.cases({
      "native": function(id) {
        return Type.entity(id);
      },
      param: function(name, args) {
        var arg;
        return Type[name].apply(Type, (function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = args.length; _i < _len; _i++) {
            arg = args[_i];
            _results.push(arg.realize());
          }
          return _results;
        })());
      },
      other: function() {
        return Type.abstract(this);
      }
    });
  };

  TypeExpr.prototype.inspect = function() {
    return this.cases({
      expr: function(e) {
        return "<" + (e.inspect()) + ">";
      },
      error: function(t, args) {
        var a;
        return "?" + t + "(" + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = args.length; _i < _len; _i++) {
            a = args[_i];
            _results.push(a.inspect());
          }
          return _results;
        })()).join(' ')) + ")";
      },
      variable: function(name, uniq) {
        return "%" + name + uniq;
      },
      query: function(input, _, query) {
        return "" + (input.inspect()) + "[" + (query.inspect()) + "]";
      },
      lexical: function(syntax, scope) {
        return "." + syntax.name + ":" + (scope.key());
      },
      destructure: function(constraint, name, argnum) {
        return "" + (constraint.inspect()) + "/" + name + "[" + argnum + "]";
      },
      "native": function(id) {
        return "!" + id;
      },
      param: function(name, exprs) {
        var expr;
        if (!exprs.length) {
          return "(" + name + ")";
        }
        exprs = (function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = exprs.length; _i < _len; _i++) {
            expr = exprs[_i];
            _results.push(expr.inspect());
          }
          return _results;
        })();
        return "(" + name + " " + (exprs.join(' ')) + ")";
      },
      error: function(t, args) {
        var a;
        return "?" + t + "(" + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = args.length; _i < _len; _i++) {
            a = args[_i];
            _results.push(a.inspect());
          }
          return _results;
        })()).join(' ')) + ")";
      },
      any: function() {
        return '*';
      }
    });
  };

  TypeExpr.prototype.equals = function(other) {
    if (this._tag !== other._tag) {
      return false;
    }
    return this.hash() === other.hash();
  };

  uniqError = 0;

  TypeExpr.prototype.hash = function() {
    var recurse;
    return this.__hash__ || (this.__hash__ = (recurse = function(texpr) {
      return texpr.cases({
        expr: function(e) {
          return "<" + (e.hash()) + ">";
        },
        query: function(input, scope, query) {
          return "" + (query.inspect()) + ":" + scope.uniq + "[" + (recurse(input)) + "]";
        },
        lexical: function(syntax, scope) {
          return "." + (syntax.hash()) + ":" + (scope.key());
        },
        "native": function(id) {
          return "!" + id;
        },
        param: function(name, constraints) {
          var c;
          return "(" + name + " " + (((function() {
            var _i, _len, _results;
            _results = [];
            for (_i = 0, _len = constraints.length; _i < _len; _i++) {
              c = constraints[_i];
              _results.push(recurse(c));
            }
            return _results;
          })()).join(' ')) + ")";
        },
        destructure: function(constraint, name, argnum) {
          return "" + (recurse(constraint)) + "/" + name + "[" + argnum + "]";
        },
        any: function() {
          return '*';
        },
        variable: function(name, uniq) {
          return "%" + uniq;
        },
        error: function() {
          return "!" + (uniqError += 1);
        }
      });
    })(this));
  };

  TypeExpr.fromAST = function(typeAST, scope, genUniq) {
    var r;
    return (r = function(typeAST) {
      var e;
      e = TypeExpr;
      return typeAST.cases({
        concrete: function(name) {
          
          return TypeExpr.param(name, []);
        },
        variable: function(name) {
          return scope.cache(name, function() {
            return TypeExpr.variable(name, genUniq());
          });
        },
        "native": function(id) {
          return TypeExpr["native"](id);
        },
        wildcard: function() {
          return TypeExpr.any();
        },
        list: function(el) {
          return e.param('list', [r(el)]);
        },
        block: function(el) {
          return e.param('block', [r(el.from), r(el.to)]);
        },
        pair: function(first, second) {
          return e.param('pair', [r(first), r(second)]);
        }
      });
    })(typeAST);
  };

  TypeExpr.fromType = function(t) {
    var st;
    if (t._tag === 'entity') {
      return TypeExpr["native"](t.id);
    }
    return TypeExpr.param(t._tag, (function() {
      var _i, _len, _ref9, _results;
      _ref9 = t._values;
      _results = [];
      for (_i = 0, _len = _ref9.length; _i < _len; _i++) {
        st = _ref9[_i];
        _results.push(this.fromType(st));
      }
      return _results;
    }).call(this));
  };

  TypeExpr.prototype.map = function(f) {
    return this.cases({
      param: function(name, params) {
        var p;
        return TypeExpr.param(name, (function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = params.length; _i < _len; _i++) {
            p = params[_i];
            _results.push(f(p));
          }
          return _results;
        })());
      },
      query: function(input, scope, query) {
        return TypeExpr.query(f(input), scope, query);
      },
      destructure: function(constraint, name, argnum) {
        return TypeExpr.destructure(f(constraint), name, argnum);
      },
      other: function() {
        return this;
      }
    });
  };

  return TypeExpr;

})(Variant);

analyze = Gibbon.analyze = (function() {
  var generate, solve;
  generate = (function() {
    var NativeContext, Scope;
    NativeContext = (function() {
      function NativeContext(globalID, externalLookup) {
        this.globalID = globalID;
        this.externalLookup = externalLookup;
        this.queryCache = new Hash;
        this.genUniq = (function() {
          var i;
          i = 0;
          return function() {
            return i += 1;
          };
        })();
      }

      NativeContext.prototype.query = function(id, query) {
        var cacheKey, lookupFn;
        cacheKey = "" + id + "/" + query.type + " " + (query.args.join(' '));
        lookupFn = this.externalLookup;
        return this.queryCache.cache(cacheKey, function() {
          var result;
          result = lookupFn(id, query, Type);
          if (result.success) {
            return TypeLookup.response(query, result.analysis);
          } else {
            return TypeLookup.error(result.error);
          }
        });
      };

      return NativeContext;

    })();
    Scope = (function() {
      var makeKey;

      Scope.global = function(context, defs) {
        return new Scope(null, [], defs, context, new Hash);
      };

      function Scope(parent, breadcrumbs, definitions, context, metadata) {
        this.parent = parent;
        this.breadcrumbs = breadcrumbs;
        this.definitions = definitions;
        this.context = context;
        this.metadata = metadata;
        this.bindings = new Hash;
        this.uniq = this.context.genUniq();
      }

      Scope.prototype.extend = function(definition) {
        var breadcrumbs, definitions, key, metadata, text, _i, _len, _ref10, _ref9;
        breadcrumbs = this.breadcrumbs.concat(definition.name);
        definitions = definition.frame.definitions;
        metadata = new Hash;
        _ref9 = definition.metadata;
        for (_i = 0, _len = _ref9.length; _i < _len; _i++) {
          _ref10 = _ref9[_i], key = _ref10.key, text = _ref10.text;
          metadata.set(key, text);
        }
        return new Scope(this, breadcrumbs, definitions, this.context, metadata);
      };

      Scope.prototype.lookup = function(nativeId, query) {
        return this.context.query(nativeId, query);
      };

      Scope.prototype.lexicalLookup = function(name) {
        if (this.bindings.has(name)) {
          return this.keyFor(name);
        } else {
          if (this.parent) {
            return this.parent.lexicalLookup(name);
          }
        }
      };

      makeKey = function(crumbs) {
        return '/' + crumbs.join('/');
      };

      Scope.prototype.key = function() {
        return this._key || (this._key = makeKey(this.breadcrumbs));
      };

      Scope.prototype.keyFor = function(name) {
        return makeKey(this.breadcrumbs.concat([name]));
      };

      Scope.prototype.analyze = function(push) {
        var def, framePush, frameScope, global, _i, _len, _ref9, _results,
          _this = this;
        global = TypeExpr["native"](this.context.globalID);
        _ref9 = this.definitions;
        _results = [];
        for (_i = 0, _len = _ref9.length; _i < _len; _i++) {
          def = _ref9[_i];
          frameScope = this.bindings.set(def.name, this.extend(def));
          frameScope.analyze(push);
          framePush = function(lhs, rhs) {
            return push(frameScope, def.frame, [lhs, rhs]);
          };
          _results.push(frameScope.analyzeFlow(def.frame.flow, global, framePush));
        }
        return _results;
      };

      Scope.prototype.analyzeFlow = function(flow, global, push) {
        var _this = this;
        if (flow.tail) {
          this.analyzeFlow(flow.tail, global, push);
        }
        return flow.head.cases({
          query: function() {
            var input;
            input = flow.tail ? TypeExpr.expr(flow.tail) : global;
            return push(TypeExpr.expr(flow), TypeExpr.query(input, _this, flow.head));
          },
          lexical: function(_, name) {
            return push(TypeExpr.expr(flow), TypeExpr.lexical(flow.head, _this));
          },
          pair: function(_, first, second) {
            _this.analyzeFlow(first, global, push);
            _this.analyzeFlow(second, global, push);
            return push(TypeExpr.expr(flow), TypeExpr.param('pair', [TypeExpr.expr(first), TypeExpr.expr(second)]));
          },
          func: function(_, name, args) {
            var arg, ast, func, genUniq, i, input, scope, _i, _len, _results;
            if (!stdlib.hasOwnProperty(name)) {
              push(TypeExpr.expr(flow.head), TypeExpr.error('func', [flow.head]));
              return;
            }
            func = stdlib[name];
            ast = func.type;
            scope = new Hash;
            flow.head.__scope__ = scope;
            genUniq = _this.context.genUniq;
            input = TypeExpr.fromAST(ast.input, scope, genUniq);
            if (flow.tail) {
              push(TypeExpr.expr(flow.tail), input);
            } else {
              push(input, global);
            }
            push(TypeExpr.expr(flow), TypeExpr.fromAST(ast.output, scope, genUniq));
            _results = [];
            for (i = _i = 0, _len = args.length; _i < _len; i = ++_i) {
              arg = args[i];
              push(TypeExpr.expr(arg), TypeExpr.fromAST(ast.args[i], scope, genUniq));
              _results.push(_this.analyzeFlow(arg, global, push));
            }
            return _results;
          },
          integer: function() {
            return push(TypeExpr.expr(flow), TypeExpr.param('numeric', []));
          },
          decimal: function() {
            return push(TypeExpr.expr(flow), TypeExpr.param('numeric', []));
          },
          string: function() {
            return push(TypeExpr.expr(flow), TypeExpr.param('string', []));
          },
          subst: function(_, subFlow) {
            push(TypeExpr.expr(flow), TypeExpr.expr(subFlow));
            return _this.analyzeFlow(subFlow, global, push);
          },
          list: function(_, elements) {
            var el, elVar, _i, _len, _results;
            elVar = TypeExpr.variable('el', _this.context.genUniq());
            push(TypeExpr.expr(flow), TypeExpr.param('list', [elVar]));
            _results = [];
            for (_i = 0, _len = elements.length; _i < _len; _i++) {
              el = elements[_i];
              _this.analyzeFlow(el, global, push);
              _results.push(push(TypeExpr.expr(el), elVar));
            }
            return _results;
          },
          block: function(_, subFlow) {
            var input;
            input = TypeExpr.variable('.input', _this.context.genUniq());
            push(TypeExpr.expr(flow), TypeExpr.param('block', [input, TypeExpr.expr(subFlow)]));
            return _this.analyzeFlow(subFlow, input, push);
          },
          defaulted: function(_, body, alt) {
            push(TypeExpr.expr(body), TypeExpr.expr(alt));
            push(TypeExpr.expr(flow), TypeExpr.expr(alt));
            _this.analyzeFlow(body, global, push);
            return _this.analyzeFlow(alt, global, push);
          }
        });
      };

      return Scope;

    })();
    return function(globalID, externalLookup, program) {
      var constraintMap, context, scope;
      context = new NativeContext(globalID, externalLookup);
      scope = Scope.global(context, program.definitions);
      constraintMap = new Hash;
      scope.analyze(function(scope, frame, constraint) {
        var entry;
        entry = constraintMap.cache(scope.key(), function() {
          return {
            scope: scope,
            frame: frame,
            constraints: []
          };
        });
        return entry.constraints.push(constraint);
      });
      return constraintMap;
    };
  })();
  solve = (function() {
    var SolveState, Solver, TypeError, _ref9;
    
    TypeError = (function(_super) {
      __extends(TypeError, _super);

      function TypeError() {
        _ref9 = TypeError.__super__.constructor.apply(this, arguments);
        return _ref9;
      }

      TypeError.variants({
        match: ['lhs', 'rhs'],
        destructure: ['type'],
        lookup: ['query', 'id', 'error'],
        lexical: ['name', 'scope'],
        circular: ['crumbs'],
        func: ['node']
      });

      TypeError.prototype.inspect = function() {
        return this.cases({
          match: function(lhs, rhs) {
            return "could not match " + (lhs.inspect()) + " with " + (rhs.inspect());
          },
          destructure: function(type) {
            return "failure to destructure " + (type.inspect());
          },
          lookup: function(query, id, error) {
            return "error looking up " + (query.inspect()) + " on " + id + ": " + error;
          },
          lexical: function(name, scope) {
            return "." + name + " is not defined in " + (scope.key());
          },
          circular: function(crumbs) {
            return "circular reference: " + (crumbs.join(' -> '));
          },
          func: function(node) {
            return "no such function " + node.name + " (in " + (node.inspect()) + ")";
          }
        });
      };

      return TypeError;

    })(Variant);
    SolveState = (function() {
      function SolveState(constraintMap) {
        this.constraintMap = constraintMap;
        this.locks = new Hash;
        this.crumbs = [];
        this.errors = [];
        this.semantics = new Hash;
      }

      SolveState.prototype.solved = function(key, semantic) {
        return this.semantics.set(key, semantic);
      };

      SolveState.prototype.solverFor = function(key) {
        return new Solver(this, key);
      };

      SolveState.prototype.solveKey = function(key) {
        if (this.semantics.has(key)) {
          return TypeExpr.fromType(this.semantics.get(key).flow.type);
        }
        return this.solverFor(key).solve();
      };

      SolveState.prototype.solveAll = function() {
        var key, _i, _len, _ref10;
        
        _ref10 = this.constraintMap.keys();
        for (_i = 0, _len = _ref10.length; _i < _len; _i++) {
          key = _ref10[_i];
          this.solveKey(key);
        }
        if (this.errors.length === 0) {
          return {
            success: true,
            semantics: this.semantics
          };
        } else {
          return {
            success: false,
            errors: this.errors
          };
        }
      };

      return SolveState;

    })();
    Solver = (function() {
      function Solver(state, key) {
        var entry;
        this.state = state;
        this.key = key;
        entry = this.state.constraintMap.get(this.key);
        this.scope = entry.scope;
        this.frame = entry.frame;
        this.constraints = entry.constraints.reverse();
        this.dependencies = [];
        this.solutions = new ObjHash;
        this.queryResults = new ObjHash;
      }

      Solver.prototype.error = function() {
        var args, type;
        type = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
        this.state.errors.push(TypeError[type].apply(TypeError, args));
        return TypeExpr.any();
      };

      Solver.prototype.hasErrors = function() {
        return this.state.errors.length > 0;
      };

      Solver.prototype.typeOf = function(expr) {
        if (this.solutions.has(expr)) {
          return this.solutions.get(expr).realize();
        }
        return expr.cases({
          expr: function() {
            throw new Error('unsolved!');
          },
          other: function() {
            return Type.abstract(TypeExpr.expr(expr));
          }
        });
      };

      Solver.prototype.makeSemantic = function(expr) {
        var _this = this;
        return expr.cases({
          frame: function(_, __, flow) {
            return Semantic.definition(_this.dependencies, _this.makeSemantic(flow), _this.scope.metadata);
          },
          flow: function(_, head, tail) {
            return Semantic.flow(_this.typeOf(TypeExpr.expr(expr)), _this.makeSemantic(head), tail && _this.makeSemantic(tail));
          },
          query: function(_, type, name) {
            if (!(_this.hasErrors() || _this.queryResults.has(expr))) {
              throw "panic: unsolved query with no errors!";
            }
            return _this.queryResults.get(expr);
          },
          lexical: function(_, name) {
            return _this.queryResults.get(expr);
          },
          func: function(_, name, args) {
            var a, semArgs, solvedScope, typeScope;
            typeScope = expr.__scope__;
            solvedScope = new Hash;
            typeScope && typeScope.each(function(name, texpr) {
              return solvedScope.set(name, _this.typeOf(texpr));
            });
            semArgs = (function() {
              var _i, _len, _results;
              _results = [];
              for (_i = 0, _len = args.length; _i < _len; _i++) {
                a = args[_i];
                _results.push(this.makeSemantic(a));
              }
              return _results;
            }).call(_this);
            return Semantic.func(name, semArgs, solvedScope);
          },
          pair: function(_, first, second) {
            return Semantic.pair(_this.makeSemantic(first), _this.makeSemantic(second));
          },
          block: function(_, flow) {
            return Semantic.block(_this.makeSemantic(flow));
          },
          subst: function(_, subFlow) {
            return _this.makeSemantic(subFlow);
          },
          list: function(_, elements, squish) {
            var e;
            return Semantic.list((function() {
              var _i, _len, _results;
              _results = [];
              for (_i = 0, _len = elements.length; _i < _len; _i++) {
                e = elements[_i];
                _results.push(this.makeSemantic(e));
              }
              return _results;
            }).call(_this), squish);
          },
          defaulted: function(_, body, alt) {
            return Semantic.defaulted(_this.makeSemantic(body), _this.makeSemantic(alt));
          },
          integer: function() {
            return Semantic.literal(this);
          },
          decimal: function() {
            return Semantic.literal(this);
          },
          percent: function() {
            return Semantic.literal(this);
          },
          fraction: function() {
            return Semantic.literal(this);
          },
          string: function() {
            return Semantic.literal(this);
          }
        });
      };

      Solver.prototype.lookup = function(scope, id, query) {
        var lookup,
          _this = this;
        lookup = scope.lookup(id, query);
        this.dependencies.push(lookup);
        return lookup.cases({
          error: function(e) {
            return _this.error('lookup', query, id, e);
          },
          response: function(_, analysis) {
            _this.queryResults.set(query, Semantic.query({
              annotations: analysis.annotations,
              type: analysis.type.toSexpr()
            }));
            return TypeExpr.fromType(analysis.type);
          }
        });
      };

      Solver.prototype.lexicalLookup = function(syntax, scope) {
        var lookupKey;
        lookupKey = scope.lexicalLookup(syntax.name);
        if (!lookupKey) {
          return this.error('lexical', name, scope);
        }
        this.queryResults.set(syntax, Semantic.localAccessor(lookupKey));
        this.dependencies.push(TypeLookup.local(lookupKey));
        return this.state.solveKey(lookupKey);
      };

      Solver.prototype.resolve = function(expr) {
        var _this = this;
        return expr.cases({
          error: function(type, args) {
            return _this.error.apply(_this, [type].concat(__slice.call(args)));
          },
          destructure: function(constraint, name, argnum) {
            return _this.resolve(constraint).cases({
              param: function(paramName, paramArgs) {
                if (paramName === name) {
                  return paramArgs[argnum];
                } else {
                  return _this.error('destructure', expr);
                }
              },
              other: function() {
                return _this.error('destructure', expr);
              }
            });
          },
          lexical: function(syntax, scope) {
            return _this.lexicalLookup(syntax, scope);
          },
          query: function(input, scope, query) {
            return _this.resolve(input).cases({
              "native": function(id) {
                return _this.lookup(scope, id, query);
              },
              other: function() {
                return expr;
              }
            });
          },
          other: function() {
            return expr.map(function(e) {
              return _this.resolve(e);
            });
          }
        });
      };

      Solver.prototype.substitute = function(texpr) {
        var _this = this;
        return this.solutions.fetch(texpr, function() {
          return texpr.map(function(e) {
            return _this.substitute(e);
          });
        });
      };

      Solver.prototype.fullSubstitute = function(texpr) {
        var resolved, substituted;
        substituted = this.substitute(texpr);
        resolved = this.resolve(substituted);
        
        return resolved;
      };

      Solver.prototype.addSolution = function(lhs, rhs) {
        var _this = this;
        
        this.solutions.set(lhs, rhs);
        return this.solutions.each(function(k, texpr) {
          return _this.solutions.set(k, _this.fullSubstitute(texpr));
        });
      };

      Solver.prototype.processPair = function(lhs, rhs) {
        var log, matchError, push, solveFor, swap,
          _this = this;
        
        push = function(newLhs, newRhs) {
          return _this.constraints.push([newLhs, newRhs]);
        };
        solveFor = function() {
          rhs = _this.fullSubstitute(rhs);
          if (_this.solutions.has(lhs)) {
            return push(_this.solutions.get(lhs), rhs);
          } else {
            return _this.addSolution(lhs, rhs);
          }
        };
        log = function() {
          return DEBUG.logConstraint('?> ', lhs, rhs);
        };
        swap = function() {
          return push(rhs, lhs);
        };
        matchError = function() {
          
          return _this.error('match', lhs, rhs);
        };
        if ('any' === rhs._tag || 'any' === lhs._tag) {
          return;
        }
        if (lhs.equals(rhs)) {
          return;
        }
        return lhs.cases({
          expr: solveFor,
          variable: solveFor,
          query: function() {
            return rhs.cases({
              expr: swap,
              variable: swap,
              param: swap,
              other: log
            });
          },
          "native": function(id) {
            return rhs.cases({
              variable: swap,
              expr: swap,
              "native": function(otherId) {
                if (id !== otherId) {
                  return matchError();
                }
              },
              query: swap,
              other: matchError
            });
          },
          param: function() {
            return rhs.cases({
              param: function() {
                var constraint, i, _i, _len, _ref10, _results;
                if (lhs.name !== rhs.name) {
                  return matchError();
                }
                _ref10 = lhs.constraints;
                _results = [];
                for (i = _i = 0, _len = _ref10.length; _i < _len; i = ++_i) {
                  constraint = _ref10[i];
                  _results.push(push(constraint, rhs.constraints[i]));
                }
                return _results;
              },
              query: function() {
                var c, i, _i, _len, _ref10, _results;
                _ref10 = lhs.constraints;
                _results = [];
                for (i = _i = 0, _len = _ref10.length; _i < _len; i = ++_i) {
                  c = _ref10[i];
                  _results.push(push(c, TypeExpr.destructure(rhs, lhs.type, i)));
                }
                return _results;
              },
              expr: swap,
              variable: swap,
              other: matchError
            });
          },
          other: log
        });
      };

      Solver.prototype.registeredType = function() {
        if (!this.state.semantics.has(this.key)) {
          return null;
        }
        return TypeExpr.fromType(this.state.semantics.get(this.key).flow.type);
      };

      Solver.prototype.register = function() {
        
        return this.state.semantics.set(this.key, this.makeSemantic(this.frame));
      };

      Solver.prototype.setLock = function() {
        
        return this.state.locks.set(this.key, true);
      };

      Solver.prototype.clearLock = function() {
        
        return this.state.locks.set(this.key, false);
      };

      Solver.prototype.isLocked = function() {
        return this.state.locks.get(this.key);
      };

      Solver.prototype.withLock = function(fn) {
        var result;
        this.state.crumbs.push(this.key);
        if (this.isLocked()) {
          result = this.error('circular', this.state.crumbs.slice());
        } else {
          this.setLock();
          result = fn(this);
          this.clearLock();
        }
        this.state.crumbs.pop();
        return result;
      };

      Solver.prototype.solve = function() {
        var _this = this;
        return this.withLock(function() {
          var lhs, rhs, _ref10;
          
          while (_this.constraints.length > 0) {
            _ref10 = _this.constraints.pop(), lhs = _ref10[0], rhs = _ref10[1];
            _this.processPair(lhs, rhs);
          }
          
          if (!_this.hasErrors()) {
            _this.register();
          }
          return _this.solutions.fetch(TypeExpr.expr(_this.frame.flow), function() {
            return TypeExpr.any();
          });
        });
      };

      return Solver;

    })();
    return function(constraintMap) {
      return new SolveState(constraintMap).solveAll();
    };
  })();
  return function(program, globalID, external) {
    var constraints;
    
    
    constraints = generate(globalID, external.analyzeQuery, program);
    return solve(constraints);
  };
})();

eval_ = Gibbon["eval"] = function(semantics, table, id, client, finish) {
  return Gibbon.compile(semantics).run(id, client, finish);
};

Gibbon.Core = Core = (function(_super) {
  var nameGen;

  __extends(Core, _super);

  function Core() {
    _ref9 = Core.__super__.constructor.apply(this, arguments);
    return _ref9;
  }

  Core.variants({
    global: [],
    constant: ['value'],
    variable: ['name'],
    branch: ['cond', 'ifTrue', 'ifFalse'],
    delist: ['expr', 'index'],
    depair: ['expr', 'key'],
    list: ['elements'],
    foldList: ['list', 'out', 'arg', 'accumArg', 'idxArg', 'body'],
    mapList: ['list', 'arg', 'idxArg', 'body'],
    zipLists: ['first', 'second'],
    filterList: ['list', 'arg', 'body'],
    squishList: ['list'],
    len: ['list'],
    pair: ['first', 'second'],
    block: ['name', 'body'],
    app: ['block', 'arg'],
    query: ['expr', 'annotations'],
    localQuery: ['key'],
    fail: ['message'],
    op1: ['op', 'arg'],
    op2: ['op', 'lhs', 'rhs'],
    rescue: ['expr', 'default'],
    next: ['cont', 'args'],
    bind: ['name', 'value', 'expr']
  });

  Core.makeVariable = function(name) {
    return Core.variable(nameGen(name));
  };

  Core.prototype.branch = function(ifTrue, ifFalse) {
    return Core.branch(this, ifTrue, ifFalse);
  };

  Core.prototype.delist = function(index) {
    return Core.delist(this, index);
  };

  Core.prototype.depair = function(key) {
    if (key) {
      return this.cases({
        pair: function() {
          return this[key];
        },
        other: function() {
          return Core.depair(this, key);
        }
      });
    } else {
      return [this.depair('first'), this.depair('second')];
    }
  };

  Core.prototype.query = function(annotations) {
    return Core.query(this, annotations);
  };

  Core.prototype.op1 = function(op) {
    return Core.op1(op, this);
  };

  Core.prototype.op2 = function(op, other) {
    return Core.op2(op, this, other);
  };

  Core.prototype.app = function(arg) {
    return Core.app(this, arg);
  };

  Core.prototype.squish = function() {
    return Core.squishList(this);
  };

  Core.prototype.len = function() {
    return this.cases({
      list: function(els) {
        return Core.constant(els.length);
      },
      other: function() {
        return Core.len(this);
      }
    });
  };

  Core.prototype.rescue = function(alt) {
    return Core.rescue(this, alt);
  };

  Core.prototype.isAsync = function() {
    return this.cases({
      query: function() {
        return true;
      },
      localQuery: function() {
        return true;
      },
      other: function() {
        var sub, _i, _len, _ref10;
        _ref10 = this.subtrees();
        for (_i = 0, _len = _ref10.length; _i < _len; _i++) {
          sub = _ref10[_i];
          if (sub.isAsync()) {
            return true;
          }
        }
        return false;
      }
    });
  };

  Core.prototype.isSimple = function() {
    return this.cases({
      variable: function() {
        return true;
      },
      constant: function() {
        return true;
      },
      global: function() {
        return true;
      },
      other: function() {
        return false;
      }
    });
  };

  Core.prototype.alwaysSucceeds = function() {
    return this.cases({
      query: function() {
        return false;
      },
      localQuery: function() {
        return false;
      },
      fail: function() {
        return false;
      },
      rescue: function(e, default_) {
        return e.alwaysSucceeds() || default_.alwaysSucceeds();
      },
      squishList: function() {
        return true;
      },
      other: function() {
        var subtree, _i, _len, _ref10;
        _ref10 = this.subtrees();
        for (_i = 0, _len = _ref10.length; _i < _len; _i++) {
          subtree = _ref10[_i];
          if (!subtree.alwaysSucceeds()) {
            return false;
          }
        }
        return true;
      }
    });
  };

  Core.prototype.failIf = function(message, f) {
    return f(this).branch(Core.fail(message), this);
  };

  Core.prototype.alwaysFails = function() {
    return this.cases({
      query: function() {
        return false;
      },
      localQuery: function() {
        return false;
      },
      fail: function() {
        return true;
      },
      branch: function(ifTrue, ifFalse) {
        return ifTrue.alwaysFails() && ifFalse.alwaysFails();
      },
      rescue: function(e, default_) {
        return e.alwaysFails() && default_.alwaysFails();
      },
      squishList: function() {
        return false;
      },
      foldList: function(list, out, arg, accumArg, idxArg, body) {
        if (list.alwaysFails()) {
          return true;
        }
        if (body.alwaysFails()) {
          return true;
        }
        if (body.isStrictIn(Core.variable(accumArg)) && out.alwaysFails()) {
          return true;
        }
        return false;
      },
      other: function() {
        var subtree, _i, _len, _ref10;
        _ref10 = this.subtrees();
        for (_i = 0, _len = _ref10.length; _i < _len; _i++) {
          subtree = _ref10[_i];
          if (subtree.alwaysFails()) {
            return true;
          }
        }
        return false;
      }
    });
  };

  Core.prototype.seq = function(name, f) {
    name = nameGen(name);
    return Core.bind(name, this, f(Core.variable(name)));
  };

  Core.prototype.mapList = function(f) {
    var elName, ixName;
    elName = nameGen('el');
    ixName = nameGen('i');
    return Core.mapList(this, elName, ixName, f(Core.variable(elName), Core.variable(ixName)));
  };

  Core.prototype.foldList = function(init, f) {
    var accumName, body, elName, ixName;
    elName = nameGen('el');
    ixName = nameGen('i');
    accumName = nameGen('next');
    body = f(Core.variable(elName), Core.variable(accumName), Core.variable(ixName));
    return Core.foldList(this, init, elName, accumName, ixName, body);
  };

  Core.prototype.zipList = function(other) {
    return Core.zipLists(this, other);
  };

  Core.prototype.filterList = function(f) {
    var name;
    name = nameGen('el');
    return Core.filterList(this, name, f(Core.variable(name)));
  };

  Core.prototype.subtrees = function() {
    var double, single;
    single = function(x) {
      return [x];
    };
    double = function(x, y) {
      return [x, y];
    };
    return this.cases({
      branch: function(c, t, f) {
        return [c, t, f];
      },
      bind: function(n, v, e) {
        return [v, e];
      },
      delist: double,
      depair: single,
      squishList: single,
      list: function(e) {
        return e;
      },
      foldList: function(l, o, a, aa, ia, b) {
        return [l, o, b];
      },
      mapList: function(l, a, ia, b) {
        return [l, b];
      },
      zipLists: double,
      filterList: function(l, a, b) {
        return [l, b];
      },
      len: single,
      pair: double,
      block: function(n, b) {
        return [b];
      },
      app: double,
      query: single,
      op1: function(op, v) {
        return [v];
      },
      op2: function(op, l, r) {
        return [l, r];
      },
      rescue: double,
      other: function() {
        return [];
      }
    });
  };

  Core.prototype.map = function(f) {
    return this.cases({
      branch: function(c, tr, fa) {
        return Core.branch(f(c), f(tr), f(fa));
      },
      bind: function(n, v, e) {
        return Core.bind(n, f(v), f(e));
      },
      delist: function(e, i) {
        return Core.delist(f(e), f(i));
      },
      depair: function(e, k) {
        return Core.depair(f(e), k);
      },
      list: function(els) {
        var e;
        return Core.list((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = els.length; _i < _len; _i++) {
            e = els[_i];
            _results.push(f(e));
          }
          return _results;
        })());
      },
      foldList: function(l, o, a, i, aa, b) {
        return Core.foldList(f(l), f(o), a, i, aa, f(b));
      },
      mapList: function(l, a, i, b) {
        return Core.mapList(f(l), a, i, f(b));
      },
      zipLists: function(l, r) {
        return Core.zipLists(f(l), f(r));
      },
      filterList: function(l, a, b) {
        return Core.filterList(f(l), a, f(b));
      },
      len: function(l) {
        return Core.len(f(l));
      },
      pair: function(x, y) {
        return Core.pair(f(x), f(y));
      },
      block: function(n, b) {
        return Core.block(n, f(b));
      },
      app: function(b, a) {
        return Core.app(f(b), f(a));
      },
      query: function(e, a) {
        return Core.query(f(e), a);
      },
      op1: function(o, v) {
        return Core.op1(o, f(v));
      },
      op2: function(o, l, r) {
        return Core.op2(o, f(l), f(r));
      },
      squishList: function(l) {
        return Core.squishList(f(l));
      },
      rescue: function(e, d) {
        return Core.rescue(f(e), f(d));
      },
      other: function() {
        return this;
      }
    });
  };

  Core.prototype.replace = function(expr, other) {
    if (this.equals(expr)) {
      return other;
    }
    return this.map(function(x) {
      return x.replace(expr, other);
    });
  };

  Core.prototype.subst = function(varName, expr) {
    if (this._tag === 'variable' && this.name === varName) {
      return expr;
    }
    return this.map(function(x) {
      return x.subst(varName, expr);
    });
  };

  Core.prototype.isStrictIn = function(needle) {
    if (this.equals(needle)) {
      return true;
    }
    return this.cases({
      branch: function(cond, ifTrue, ifFalse) {
        return cond.isStrictIn(needle) || (ifTrue.isStrictIn(needle) && ifFalse.isStrictIn(needle));
      },
      other: function() {
        var subtree, _i, _len, _ref10;
        _ref10 = this.subtrees();
        for (_i = 0, _len = _ref10.length; _i < _len; _i++) {
          subtree = _ref10[_i];
          if (subtree.isStrictIn(needle)) {
            return true;
          }
        }
        return false;
      }
    });
  };

  Core.prototype.contains = function(needle) {
    var subtree, _i, _len, _ref10;
    if (this.equals(needle)) {
      return true;
    }
    _ref10 = this.subtrees();
    for (_i = 0, _len = _ref10.length; _i < _len; _i++) {
      subtree = _ref10[_i];
      if (subtree.contains(needle)) {
        return true;
      }
    }
    return false;
  };

  Core.prototype.containsInNonTailPosition = function(needle) {
    if (this.equals(needle)) {
      return false;
    }
    return this.cases({
      branch: function(cond, ifTrue, ifFalse) {
        return cond.contains(needle) || ifTrue.containsInNonTailPosition(needle) || ifFalse.containsInNonTailPosition(needle);
      },
      rescue: function(body, alt) {
        return body.contains(needle) || alt.containsInNonTailPosition(needle);
      },
      other: function() {
        return this.contains(needle);
      }
    });
  };

  Core.prototype.equals = function(other) {
    if (this._tag !== other._tag) {
      return false;
    }
    return this.hash() === other.hash();
  };

  nameGen = (function() {
    var count;
    count = 0;
    return function(name) {
      return "" + name + (count += 1);
    };
  })();

  Core.prototype.inspect = function(indent) {
    if (indent == null) {
      indent = 0;
    }
    return this.cases({
      global: function() {
        return '$';
      },
      branch: function(cond, ifTrue, ifFalse) {
        return "(IF " + (cond.inspect()) + " " + (ifTrue.inspect()) + " " + (ifFalse.inspect()) + ")";
      },
      bind: function(name, val, expr) {
        return "(LET " + name + "=" + (val.inspect()) + " " + (expr.inspect()) + ")";
      },
      variable: function(name) {
        return "$" + name;
      },
      delist: function(e, i) {
        return "(DELIST " + (i.inspect()) + " " + (e.inspect()) + ")";
      },
      depair: function(e, k) {
        return "(DEPAIR/" + k + " " + (e.inspect()) + ")";
      },
      list: function(els) {
        var e;
        return "(LIST " + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = els.length; _i < _len; _i++) {
            e = els[_i];
            _results.push(e.inspect());
          }
          return _results;
        })()).join(' ')) + ")";
      },
      len: function(e) {
        return "(LEN " + (e.inspect()) + ")";
      },
      mapList: function(list, arg, i, body) {
        return "(MAP [" + arg + " " + i + "] " + (list.inspect()) + " " + (body.inspect()) + ")";
      },
      foldList: function(list, out, arg, next, i, body) {
        return "(FOLDR [" + arg + " " + next + " " + i + "] " + (list.inspect()) + " " + (out.inspect()) + " " + (body.inspect()) + ")";
      },
      filterList: function(list, arg, body) {
        return "(FILTER [" + arg + "] " + (list.inspect()) + " " + (body.inspect()) + ")";
      },
      zipLists: function(x, y) {
        return "(ZIP " + (x.inspect()) + " " + (y.inspect()) + ")";
      },
      squishList: function(l) {
        return "(SQUISH " + (l.inspect()) + ")";
      },
      pair: function(x, y) {
        return "(PAIR " + (x.inspect()) + " " + (y.inspect()) + ")";
      },
      query: function(e, a) {
        return "(QUERY " + (JSON.stringify(a)) + " " + (e.inspect()) + ")";
      },
      block: function(a, e) {
        return "(LAMBDA [" + a + "] " + (e.inspect()) + ")";
      },
      app: function(b, a) {
        return "(APPLY " + (b.inspect()) + " " + (a.inspect()) + ")";
      },
      localQuery: function(k) {
        return "@" + k;
      },
      fail: function(m) {
        return "(FAIL " + m + ")";
      },
      op1: function(op, arg) {
        return "(" + op + " " + (arg.inspect()) + ")";
      },
      op2: function(op, l, r) {
        return "(" + op + " " + (l.inspect()) + " " + (r.inspect()) + ")";
      },
      rescue: function(e, d) {
        return "(RESCUE " + (e.inspect()) + " " + (d.inspect()) + ")";
      },
      constant: function(v) {
        return inspectNative(v);
      },
      next: function() {
        return 'NEXT';
      }
    });
  };

  Core.prototype.hash = function() {
    var mkVar, r,
      _this = this;
    mkVar = (function() {
      var i;
      i = 0;
      return function() {
        return Core.variable("" + (i += 1));
      };
    })();
    return this.__hash__ || (this.__hash__ = (r = function(el) {
      return el.cases({
        global: function() {
          return '$';
        },
        branch: function(cond, ifTrue, ifFalse) {
          return "(IF " + (r(cond)) + " " + (r(ifTrue)) + " " + (r(ifFalse)) + ")";
        },
        bind: function(name, val, expr) {
          expr = expr.subst(name, mkVar());
          return "(LET " + (r(val)) + " " + (r(expr)) + ")";
        },
        variable: function(name) {
          return "v:" + name;
        },
        delist: function(e, i) {
          return "([" + (r(i)) + "] " + (r(e)) + ")";
        },
        depair: function(e, k) {
          return "([" + k + "] " + (r(e)) + ")";
        },
        list: function(els) {
          var e;
          return "(LIST " + (((function() {
            var _i, _len, _results;
            _results = [];
            for (_i = 0, _len = els.length; _i < _len; _i++) {
              e = els[_i];
              _results.push(r(e));
            }
            return _results;
          })()).join(' ')) + ")";
        },
        len: function(e) {
          return "(LEN " + (r(e)) + ")";
        },
        mapList: function(list, arg, i, body) {
          body = body.subst(arg, mkVar()).subst(i, mkVar());
          return "(MAP " + (r(list)) + " " + (r(body)) + ")";
        },
        foldList: function(list, out, arg, next, i, body) {
          body = body.subst(arg, mkVar()).subst(next, mkVar()).subst(i, mkVar());
          return "(FOLDR " + (r(list)) + " " + (r(out)) + " " + (r(body)) + ")";
        },
        filterList: function(list, arg, body) {
          body = body.subst(arg, mkVar());
          return "(FILTER " + (r(list)) + " " + (r(body)) + ")";
        },
        zipLists: function(x, y) {
          return "(ZIP " + (r(x)) + " " + (r(y)) + ")";
        },
        squishList: function(l) {
          return "(SQUISH " + (r(l)) + ")";
        },
        pair: function(x, y) {
          return "(PAIR " + (r(x)) + " " + (r(y)) + ")";
        },
        query: function(e, a) {
          return "(QUERY " + (JSON.stringify(a)) + " " + (r(e)) + ")";
        },
        block: function(arg, body) {
          body = body.subst(arg, mkVar());
          return "(LAMBDA " + (r(body)) + ")";
        },
        app: function(b, a) {
          return "(APPLY " + (r(b)) + " " + (r(a)) + ")";
        },
        localQuery: function(k) {
          return "@" + k;
        },
        fail: function(m) {
          return "(FAIL)";
        },
        op1: function(op, arg) {
          return "(OP1 " + op + " " + (r(arg)) + ")";
        },
        op2: function(op, lhs, rhs) {
          return "(OP2 " + op + " " + (r(lhs)) + " " + (r(rhs)) + ")";
        },
        rescue: function(e, d) {
          return "(RESCUE " + (r(e)) + " " + (r(d)) + ")";
        },
        constant: function(v) {
          return "(CONST " + (typeof v) + " " + v + ")";
        },
        next: function() {
          return 'NEXT';
        }
      });
    })(this));
  };

  return Core;

})(Variant);

Gibbon.translate = function(semantics) {
  var translate, translated;
  translate = function(semantic, input, context) {
    if (input == null) {
      input = Core.global();
    }
    if (context == null) {
      context = input;
    }
    return semantic.cases({
      definition: function(_, flow) {
        return translate(flow, input, context);
      },
      flow: function(_, head, tail) {
        if (tail) {
          return translate(head, translate(tail, input, context), context);
        } else {
          return translate(head, input, context);
        }
      },
      query: function(annotations) {
        return input.query(annotations);
      },
      localAccessor: function(key) {
        var definition;
        definition = semantics.get(key) || (function() {
          throw "panic: invalid reference";
        })();
        if (definition.metadata.has('export')) {
          return translate(definition, Core.global());
        } else {
          return Core.localQuery(key);
        }
      },
      func: function(name, args, tvars) {
        var arg, compArgs;
        compArgs = (function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = args.length; _i < _len; _i++) {
            arg = args[_i];
            _results.push(translate(arg, context));
          }
          return _results;
        })();
        return stdlib[name].compile(input, compArgs, tvars);
      },
      literal: function(syntax) {
        return Core.constant(syntax.value);
      },
      list: function(elements, squish) {
        var e, list;
        list = Core.list((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = elements.length; _i < _len; _i++) {
            e = elements[_i];
            _results.push(translate(e, context));
          }
          return _results;
        })());
        if (squish) {
          return list.squish();
        } else {
          return list;
        }
      },
      pair: function(x, y) {
        return Core.pair(translate(x, context), translate(y, context));
      },
      block: function(body) {
        var arg;
        arg = Core.makeVariable('arg');
        return Core.block(arg.name, translate(body, arg, arg));
      },
      defaulted: function(body, alternative) {
        return Core.rescue(translate(body, context), translate(alternative, context));
      }
    });
  };
  translated = new Hash;
  semantics.each(function(key, semantic) {
    return translated.set(key, translate(semantic));
  });
  return translated;
};

Gibbon.optimize = (function() {
  var insertBindings, partialEval, uncachedPartialEval;
  partialEval = function(expr) {
    var cache, recurse, result;
    cache = new ObjHash;
    result = (recurse = function(expr) {
      return cache.cache(expr, function() {
        return uncachedPartialEval(expr, recurse);
      });
    })(expr);
    
    return result;
  };
  uncachedPartialEval = function(expr, recurse) {
    return expr.cases({
      depair: function(expr, key) {
        return recurse(expr).cases({
          pair: function() {
            
            return this[key];
          },
          other: function() {
            return this.depair(key);
          }
        });
      },
      delist: function(expr, index) {
        return recurse(expr).cases({
          list: function(els) {
            
            return els[index];
          },
          other: function() {
            return this.delist(index);
          }
        });
      },
      branch: function(cond, ifTrue, ifFalse) {
        var abort,
          _this = this;
        cond = recurse(cond);
        abort = function() {
          var _ref10;
          ifTrue = recurse(ifTrue);
          ifFalse = recurse(ifFalse);
          if (ifTrue.equals(ifFalse)) {
            
            return ifTrue;
          }
          if (ifTrue._tag === 'constant' && ifFalse._tag === 'constant' && ((_ref10 = ifTrue.value) === true || _ref10 === false)) {
            
            return (ifTrue.value ? cond : recurse(cond.op1('!')));
          }
          return cond.branch(ifTrue, ifFalse);
        };
        return cond.cases({
          constant: function(value) {
            if (value) {
              
              return recurse(ifTrue);
            } else {
              
              return recurse(ifFalse);
            }
          },
          branch: function(innerCond, innerTrue, innerFalse) {
            debugger;
            
            return recurse(innerCond.branch(innerTrue.branch(ifTrue, ifFalse), innerFalse.branch(ifTrue, ifFalse)));
          },
          op1: function(name, arg) {
            if (name === '!') {
              
              return recurse(arg.branch(ifFalse, ifTrue));
            } else {
              return abort();
            }
          },
          other: abort
        });
      },
      app: function(block, arg) {
        return recurse(block).cases({
          block: function(argName, body) {
            
            return recurse(body.subst(argName, arg));
          },
          other: function() {
            return this.app(recurse(arg));
          }
        });
      },
      mapList: function(list, arg, ixName, body) {
        return recurse(list).cases({
          list: function(elements) {
            var el, i, mapped;
            
            mapped = (function() {
              var _i, _len, _results;
              _results = [];
              for (i = _i = 0, _len = elements.length; _i < _len; i = ++_i) {
                el = elements[i];
                
                _results.push(recurse(body.subst(arg, el).subst(ixName, Core.constant(i))));
              }
              return _results;
            })();
            return recurse(Core.list(mapped));
          },
          mapList: function(innerList, innerArg, innerIdxArg, innerBody) {
            var newBody;
            
            newBody = body.subst(arg, innerBody).subst(ixName, Core.variable(innerIdxArg));
            return recurse(Core.mapList(innerList, innerArg, innerIdxArg, newBody));
          },
          other: function() {
            return Core.mapList(recurse(this), arg, ixName, recurse(body));
          }
        });
      },
      foldList: function(list, out, arg, accum, ixName, body) {
        return recurse(list).cases({
          list: function(elements) {
            var _loop;
            
            return recurse((_loop = function(i) {
              var next;
              if (i >= elements.length) {
                return recurse(out);
              }
              next = _loop(i + 1);
              
              return body.subst(arg, elements[i]).subst(accum, next).subst(ixName, Core.constant(i));
            })(0));
          },
          mapList: function(innerList, innerArg, innerIdxArg, mapBody) {
            var newBody;
            
            newBody = body.subst(arg, mapBody).subst(ixName, Core.variable(innerIdxArg));
            return Core.foldList(innerList, out, innerArg, accum, innerIdxArg, newBody);
          },
          squishList: function(list) {
            if (list._tag === 'list' && !body.containsInNonTailPosition(Core.variable(accum))) {
              
              body = Core.rescue(body.subst(accum, Core.fail('next')), Core.variable(accum));
              return recurse(Core.foldList(list, out, arg, accum, ixName, body));
            } else {
              return Core.foldList(this, recurse(out), arg, accum, ixName, recurse(body));
            }
          },
          other: function() {
            return Core.foldList(this, recurse(out), arg, accum, ixName, recurse(body));
          }
        });
      },
      squishList: function(list) {
        var allSucceed, e, nonFailures, _i, _len, _ref10;
        if (list._tag !== 'list') {
          return Core.squishList(recurse(list));
        }
        allSucceed = true;
        nonFailures = [];
        _ref10 = list.elements;
        for (_i = 0, _len = _ref10.length; _i < _len; _i++) {
          e = _ref10[_i];
          e = recurse(e);
          if (e.alwaysFails()) {
            
            continue;
          }
          nonFailures.push(e);
          if (!e.alwaysSucceeds()) {
            allSucceed = false;
          }
        }
        if (allSucceed) {
          
          return Core.list(nonFailures);
        } else {
          return Core.squishList(Core.list(nonFailures));
        }
      },
      len: function(list) {
        return recurse(list).cases({
          list: function(elements) {
            
            return Core.constant(elements.length);
          },
          mapList: function(list) {
            
            return recurse(list.len());
          },
          zipLists: function(l, r) {
            
            return recurse(l.len());
          },
          other: function() {
            return this.len();
          }
        });
      },
      zipLists: function(l, r) {
        var e, elements, i;
        l = recurse(l);
        r = recurse(r);
        if (!(l._tag === 'list' && r._tag === 'list')) {
          return Core.zipLists(l, r);
        }
        elements = (function() {
          var _i, _len, _results;
          _results = [];
          for (i = _i = 0, _len = l.length; _i < _len; i = ++_i) {
            e = l[i];
            _results.push(Core.pair(e, r[i]));
          }
          return _results;
        })();
        return recurse(Core.list(elements));
      },
      op1: function(op, arg) {
        return recurse(arg).cases({
          constant: function(value) {
            return Core.constant(applyOp1(op, value));
          },
          other: function() {
            return Core.op1(op, this);
          }
        });
      },
      op2: function(op, left, right) {
        var checkConst, checkIdent, identFold, l, r, _ref10;
        left = recurse(left);
        right = recurse(right);
        checkConst = function(val, f) {
          return val._tag === 'constant' && f(val.value);
        };
        if (op === '>' || op === '<' || op === '>=' || op === '<=') {
          if (checkConst(left, function(x) {
            return !isFinite(x);
          })) {
            
            right = Core.constant(0);
          } else if (checkConst(right, function(x) {
            return !isFinite(x);
          })) {
            
            left = Core.constant(0);
          }
        } else {
          checkIdent = function(opTest, val, ident, identVal) {
            return op === opTest && checkConst(val, function(x) {
              return x === ident;
            }) && identVal;
          };
          identFold = checkIdent('*', right, 1, left) || checkIdent('*', left, 1, right) || checkIdent('*', right, 0, Core.constant(0)) || checkIdent('*', left, 0, Core.constant(0)) || checkIdent('+', left, 0, right) || checkIdent('+', right, 0, left) || checkIdent('/', right, 1, left);
          if (identFold) {
            
            return identFold;
          }
        }
        if (!(left._tag === 'constant' && right._tag === 'constant')) {
          return Core.op2(op, left, right);
        }
        
        _ref10 = [left.value, right.value], l = _ref10[0], r = _ref10[1];
        return Core.constant(applyOp2(op, left.value, right.value));
      },
      rescue: function(expr, default_) {
        expr = recurse(expr);
        if (expr.alwaysSucceeds()) {
          
          return expr;
        } else if (expr.alwaysFails()) {
          
          return recurse(default_);
        } else {
          return Core.rescue(expr, recurse(default_));
        }
      },
      other: function() {
        return this.map(recurse);
      }
    });
  };
  insertBindings = (function() {
    var SubstTree, findLastCommon, genSubstitutions, insertSubstitutions, makeCrumbs, _ref10;
    SubstTree = (function(_super) {
      __extends(SubstTree, _super);

      function SubstTree() {
        _ref10 = SubstTree.__super__.constructor.apply(this, arguments);
        return _ref10;
      }

      SubstTree.variants({
        subst: ['bindings', 'expr']
      });

      SubstTree.prototype.toCore = function() {
        return this.__toCore || (this.__toCore = this.expr.map(function(x) {
          return x.toCore();
        }));
      };

      SubstTree.prototype.inspect = function() {
        var e;
        if (!this.bindings.length) {
          return this.expr.inspect();
        }
        return "(subst [" + (((function() {
          var _i, _len, _ref11, _results;
          _ref11 = this.bindings;
          _results = [];
          for (_i = 0, _len = _ref11.length; _i < _len; _i++) {
            e = _ref11[_i];
            _results.push(e.inspect());
          }
          return _results;
        }).call(this)).join(' ')) + "] " + (this.expr.inspect()) + ")";
      };

      SubstTree.prototype.map = function(f) {
        var e;
        return SubstTree.subst((function() {
          var _i, _len, _ref11, _results;
          _ref11 = this.bindings;
          _results = [];
          for (_i = 0, _len = _ref11.length; _i < _len; _i++) {
            e = _ref11[_i];
            _results.push(e.map(f));
          }
          return _results;
        }).call(this), this.expr.map(f));
      };

      SubstTree.prototype.substituteWith = function(names, bindableExprs) {
        var bindable, core, hash, i, _i, _len, _ref11;
        core = this.toCore();
        hash = core.hash();
        for (i = _i = 0, _len = bindableExprs.length; _i < _len; i = ++_i) {
          bindable = bindableExprs[i];
          if (hash === bindable.toCore().hash()) {
            return SubstTree.unit(Core.variable(names[i]));
          }
        }
        if ((_ref11 = this.expr._tag) === 'rescue' || _ref11 === 'squishList') {
          return this;
        }
        return this.map(function(x) {
          return x.substituteWith(names, bindableExprs);
        });
      };

      SubstTree.prototype.simplify = function() {
        var bindableExprs, expr;
        bindableExprs = this.bindings;
        expr = this.expr;
        return expr.cases({
          rescue: function() {
            return SubstTree.unit(this.map(function(x) {
              return insertSubstitutions(x.toCore());
            }));
          },
          squishList: function(list) {
            list = list.toCore();
            if (list._tag !== 'list') {
              throw 'invalid squish';
            }
            return SubstTree.unit(Core.squishList(SubstTree.unit(list.map(insertSubstitutions))));
          },
          other: function() {
            var bindable, i, names, out, _, _i, _len;
            if (bindableExprs.length) {
              names = (function() {
                var _i, _len, _results;
                _results = [];
                for (_i = 0, _len = bindableExprs.length; _i < _len; _i++) {
                  _ = bindableExprs[_i];
                  _results.push(nameGen('b'));
                }
                return _results;
              })();
              
              out = SubstTree.unit(expr).substituteWith(names, bindableExprs);
              for (i = _i = 0, _len = bindableExprs.length; _i < _len; i = ++_i) {
                bindable = bindableExprs[i];
                out = SubstTree.unit(Core.bind(names[i], bindable, out));
              }
              
            } else {
              out = SubstTree.unit(expr);
            }
            return out.map(function(t) {
              return t.simplify();
            });
          }
        });
      };

      SubstTree.unit = function(expr) {
        return SubstTree.subst([], expr);
      };

      return SubstTree;

    })(Variant);
    makeCrumbs = function(trace) {
      return trace.toArray().reverse();
    };
    genSubstitutions = function(expr) {
      var occurrences, queue, recurse, substitutions;
      occurrences = new ObjHash;
      substitutions = new ObjHash;
      queue = [[expr, List.empty()]];
      while (queue.length) {
        (function(_arg) {
          var expr, newTrace, sub, trace, _i, _len, _ref11, _ref12, _results;
          expr = _arg[0], trace = _arg[1];
          if (expr.isSimple() || expr.alwaysFails()) {
            return;
          }
          if (occurrences.has(expr)) {
            return occurrences.get(expr).push(makeCrumbs(trace));
          } else {
            occurrences.set(expr, [makeCrumbs(trace)]);
            newTrace = trace.cons(expr);
            if ((_ref11 = expr._tag) === 'rescue' || _ref11 === 'squishList') {
              return;
            }
            _ref12 = expr.subtrees();
            _results = [];
            for (_i = 0, _len = _ref12.length; _i < _len; _i++) {
              sub = _ref12[_i];
              _results.push(queue.push([sub, newTrace]));
            }
            return _results;
          }
        })(queue.shift());
      }
      occurrences.each(function(expr, crumbs) {
        var insertionPoint;
        if (!(crumbs.length >= 2)) {
          return;
        }
        
        insertionPoint = findLastCommon(crumbs);
        substitutions.cache(insertionPoint, function() {
          return [];
        });
        return substitutions.get(insertionPoint).push(expr);
      });
      return (recurse = function(expr) {
        var bindableExprs, e;
        bindableExprs = substitutions.get(expr);
        if (!bindableExprs) {
          return SubstTree.unit(expr.map(recurse));
        }
        return SubstTree.subst((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = bindableExprs.length; _i < _len; _i++) {
            e = bindableExprs[_i];
            _results.push(recurse(e));
          }
          return _results;
        })(), expr.map(recurse));
      })(expr);
    };
    findLastCommon = function(_arg) {
      var i, last, refCrumb, reference, rest, testCrumbs, _i, _j, _len, _len1;
      reference = _arg[0], rest = 2 <= _arg.length ? __slice.call(_arg, 1) : [];
      last = null;
      for (i = _i = 0, _len = reference.length; _i < _len; i = ++_i) {
        refCrumb = reference[i];
        for (_j = 0, _len1 = rest.length; _j < _len1; _j++) {
          testCrumbs = rest[_j];
          if (!refCrumb.equals(testCrumbs[i])) {
            return last;
          }
        }
        last = refCrumb;
      }
      return refCrumb;
    };
    insertSubstitutions = function(expr) {
      var substitutions;
      substitutions = genSubstitutions(expr);
      
      return substitutions.simplify();
    };
    return function(expr) {
      return insertSubstitutions(expr).toCore();
    };
  })();
  return function(expr) {
    var out;
    
    out = insertBindings(partialEval(expr));
    
    return out;
  };
})();

nameGen = (function(i) {
  return function(name) {
    return "" + name + (i += 1);
  };
})(0);

Step = (function(_super) {
  __extends(Step, _super);

  function Step() {
    _ref10 = Step.__super__.constructor.apply(this, arguments);
    return _ref10;
  }

  Step.variants({
    "let": ['lval', 'value', 'expr'],
    fork: ['forks'],
    each: ['length', 'cont'],
    letCont: ['name', 'args', 'body', 'expr'],
    letJoin: ['name', 'order', 'rescue', 'cont', 'expr'],
    next: ['cont', 'args'],
    app: ['fn', 'args', 'rescue', 'next'],
    query: ['annotations', 'arg', 'rescue', 'next'],
    localQuery: ['key', 'rescue', 'next'],
    "if": ['cond', 'trueCont', 'falseCont']
  });

  Step.prototype.inspect = function() {
    return this.cases({
      "let": function(varName, value, expr) {
        return "(LET " + varName + " " + (value.inspect()) + " " + (expr.inspect()) + ")";
      },
      letCont: function(name, args, body, expr) {
        return "(LETC " + name + " \\" + (args.join(',')) + " " + (body.inspect()) + " " + (expr.inspect()) + ")";
      },
      fork: function(forks) {
        var f;
        return "(FORK " + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = forks.length; _i < _len; _i++) {
            f = forks[_i];
            _results.push("->" + f);
          }
          return _results;
        })()).join(' ')) + ")";
      },
      each: function(list, cont) {
        return "(EACH " + list + " ->" + cont + ")";
      },
      letJoin: function(name, order, rescue, cont, expr) {
        return "(LETJ " + name + "/" + order + " !-> " + rescue + " ->" + cont + " " + (expr.inspect()) + ")";
      },
      letMap: function(name, list, joinName, arg, body, expr) {
        return "(LETM " + name + " " + list + " " + joinName + "<- \\" + arg + " " + (body.inspect()) + " " + (expr.inspect()) + ")";
      },
      next: function(cont, args) {
        return "(->" + cont + " " + (args.join(' ')) + ")";
      },
      app: function(fn, args, rescue, next) {
        return "(" + fn + " " + (args.join(' ')) + " !->" + rescue + " ->" + next + ")";
      },
      query: function(annotations, arg, rescue, next) {
        return "(Q " + (JSON.stringify(annotations)) + " !->" + rescue + " ->" + next + ")";
      },
      localQuery: function(key, rescue, next) {
        return "(@" + key + " !->" + rescue + ", ->" + next + ")";
      },
      "if": function(cond, trueCont, falseCont) {
        return "(IF " + cond + " ->" + trueCont + " ->" + falseCont + ")";
      }
    });
  };

  Step.prototype.inspectLines = function(indent) {
    var i;
    if (indent == null) {
      indent = 0;
    }
    i = new Array(indent + 1).join('    ');
    return this.cases({
      "let": function(varName, value, expr) {
        return "" + i + "let " + varName + " = " + (value.inspect()) + "\n" + (expr.inspectLines(indent));
      },
      letCont: function(name, args, body, expr) {
        return "" + i + name + " " + (args.join(' ')) + ":\n" + (body.inspectLines(indent + 1)) + "\n" + (expr.inspectLines(indent));
      },
      letJoin: function(name, order, rescue, cont, expr) {
        return "" + i + name + ": join/" + order + " !->" + rescue + " ->" + cont + "\n" + (expr.inspectLines(indent));
      },
      fork: function(conts) {
        var c;
        return "" + i + "fork " + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = conts.length; _i < _len; _i++) {
            c = conts[_i];
            _results.push("->" + c);
          }
          return _results;
        })()).join(' '));
      },
      each: function(length, cont) {
        return "" + i + "each/" + length + " ->" + cont;
      },
      map: function(name, list, arg, joinName, body, expr) {
        return "" + i + name + " = map " + list + " \\" + joinName + ":\n" + (body.inspectLines(indent + 1)) + "\n" + (expr.inspectLines(indent));
      },
      next: function(name, args) {
        return "" + i + "go " + name + " " + (args.join(' '));
      },
      app: function(fn, args, rescue, next) {
        return "" + i + "app " + fn + " " + (args.join(' ')) + " !->" + rescue + " ->" + next;
      },
      query: function(annotations, arg, rescue, next) {
        return "" + i + "query " + (JSON.stringify(annotations)) + " " + arg + " !->" + rescue + " ->" + next;
      },
      localQuery: function(key, rescue, next) {
        return "" + i + "@" + key + " !->" + rescue + ", ->" + next;
      },
      "if": function(cond, trueCont, falseCont) {
        return "" + i + "if " + cond + " ->" + trueCont + " else ->" + falseCont;
      }
    });
  };

  Step.prototype.search = function(f) {
    if (f(this)) {
      return true;
    }
    return this.cases({
      "let": function(_, __, expr) {
        return expr.search(f);
      },
      project: function(_, __, ___, expr) {
        return expr.search(f);
      },
      letCont: function(_, __, body, expr) {
        return body.search(f) || expr.search(f);
      },
      letJoin: function(_, __, ___, ____, expr) {
        return expr.search(f);
      },
      other: function() {
        return false;
      }
    });
  };

  Step.prototype.map = function(f) {
    return this.cases({
      "let": function(lval, value, expr) {
        return Step["let"](lval, value.mapSteps(f), f(expr));
      },
      project: function(lval, value, index, expr) {
        return Step.project(lval, value, index, f(expr));
      },
      letCont: function(name, args, body, expr) {
        return Step.letCont(name, args, f(body), f(expr));
      },
      other: function() {
        return this;
      }
    });
  };

  Step.prototype.hasFree = function(varName) {
    return this.search(function(step) {
      return step.cases({
        "let": function(_, value, __) {
          return value.hasFree(varName);
        },
        next: function(cont, args) {
          return varName === cont || __indexOf.call(args, varName) >= 0;
        },
        app: function(fn, args, rescue, next) {
          return (varName === fn || varName === rescue || varName === next) || __indexOf.call(args, varName) >= 0;
        },
        query: function(annotations, arg, rescue, next) {
          return varName === arg || varName === rescue || varName === next;
        },
        localQuery: function(key, rescue, next) {
          return varName === rescue || varName === next;
        },
        "if": function(cond, trueCont, falseCont) {
          return varName === cond || varName === trueCont || varName === falseCont;
        },
        letJoin: function(name, order, rescue, cont) {
          return varName === order || varName === rescue || varName === cont;
        },
        fork: function(conts) {
          return __indexOf.call(conts, varName) >= 0;
        },
        each: function(name, cont) {
          return varName === name || varName === cont;
        },
        other: function() {
          return false;
        }
      });
    });
  };

  Step.prototype.subst = function(varName, target) {
    return this.cases({
      "let": function(lval, value, expr) {
        value = value.subst(varName, target);
        if (varName === lval) {
          return Step["let"](lval, value, expr);
        }
        return Step["let"](lval, value, expr.subst(varName, target));
      },
      letJoin: function(name, order, fail, cont, expr) {
        if (order === varName) {
          order = target;
        }
        if (fail === varName) {
          fail = target;
        }
        if (cont === varName) {
          cont = target;
        }
        expr = expr.subst(varName, target);
        return Step.letJoin(name, order, fail, cont, expr);
      },
      next: function(cont, args) {
        var arg, newArgs;
        if (cont === varName) {
          cont = target;
        }
        newArgs = (function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = args.length; _i < _len; _i++) {
            arg = args[_i];
            if (arg === varName) {
              _results.push(target);
            } else {
              _results.push(arg);
            }
          }
          return _results;
        })();
        return Step.next(cont, newArgs);
      },
      app: function(fn, args, rescue, next) {
        var arg;
        if (fn === varName) {
          fn = target;
        }
        if (rescue === varName) {
          rescue = target;
        }
        if (next === varName) {
          next = target;
        }
        args = (function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = args.length; _i < _len; _i++) {
            arg = args[_i];
            if (arg === varName) {
              _results.push(target);
            } else {
              _results.push(arg);
            }
          }
          return _results;
        })();
        return Step.app(fn, args, rescue, next);
      },
      query: function(annotations, arg, rescue, next) {
        if (arg === varName) {
          arg = target;
        }
        if (rescue === varName) {
          rescue = target;
        }
        if (next === varName) {
          next = target;
        }
        return Step.query(annotations, arg, rescue, next);
      },
      localQuery: function(key, rescue, next) {
        if (rescue === varName) {
          rescue = target;
        }
        if (next === varName) {
          next = target;
        }
        return Step.localQuery(key, rescue, next);
      },
      "if": function(cond, trueCont, falseCont) {
        if (cond === varName) {
          cond = target;
        }
        if (trueCont === varName) {
          trueCont = target;
        }
        if (falseCont === varName) {
          falseCont = target;
        }
        return Step["if"](cond, trueCont, falseCont);
      },
      each: function(name, cont) {
        if (name === varName) {
          name = target;
        }
        if (cont === varName) {
          cont = target;
        }
        return Step.each(name, cont);
      },
      other: function() {
        return this.map(function(x) {
          return x.subst(varName, target);
        });
      }
    });
  };

  Step.prototype.substAll = function(varNames, targets) {
    var i, replaced, varName, _i, _len;
    replaced = this;
    for (i = _i = 0, _len = varNames.length; _i < _len; i = ++_i) {
      varName = varNames[i];
      replaced = replaced.subst(varName, targets[i]);
    }
    return replaced;
  };

  Step.makeCont = function(arity, fBody, fExpr) {
    var contName, varNames;
    contName = nameGen('k');
    varNames = (function() {
      var _i, _results;
      _results = [];
      for (_i = 0; 0 <= arity ? _i < arity : _i > arity; 0 <= arity ? _i++ : _i--) {
        _results.push(nameGen('t'));
      }
      return _results;
    })();
    return Step.letCont(contName, varNames, fBody.apply(null, varNames), fExpr(contName));
  };

  Step.makeVar = function(val, f) {
    var varName;
    varName = nameGen('t');
    return Step["let"](varName, val, f(varName));
  };

  Step.makeJoin = function(order, rescue, outCont, f) {
    var joinName, joinRescueName, makeEach, makeEmpty;
    joinName = nameGen('j');
    joinRescueName = "" + joinName + "$$rescue";
    makeEach = function() {
      var mkBody;
      mkBody = function(index) {
        return f(index, joinRescueName, function(mappedVal) {
          return Step.next(joinName, [index, mappedVal]);
        });
      };
      return Step.makeCont(1, mkBody, function(bodyCont) {
        return Step.letJoin(joinName, order, rescue, outCont, Step.each(order, bodyCont));
      });
    };
    makeEmpty = function() {
      return Step.makeVar(RVal.list([]), function(boundEmpty) {
        return Step.next(outCont, [boundEmpty]);
      });
    };
    return Step.makeVar(RVal.constant(0), function(zero) {
      return Step.makeVar(RVal.prim(2, '===', [order, zero]), function(isEmpty) {
        return Step.makeCont(0, makeEach, function(eachCont) {
          return Step.makeCont(0, makeEmpty, function(emptyCont) {
            return Step["if"](isEmpty, emptyCont, eachCont);
          });
        });
      });
    });
  };

  Step.prototype.extendTrace = function(trace) {
    return this.cases;
  };

  Step.prototype.walk = function(f) {
    var recurse;
    return (recurse = function(step, trace) {
      return f(step, trace, function(newStep) {
        var newTrace;
        newTrace = trace.extendWith(step);
        return recurse(newStep, newTrace);
      });
    })(this, Trace.empty());
  };

  return Step;

})(Variant);

VarTrace = (function(_super) {
  __extends(VarTrace, _super);

  function VarTrace() {
    _ref11 = VarTrace.__super__.constructor.apply(this, arguments);
    return _ref11;
  }

  VarTrace.variants({
    value: ['val'],
    continued: ['continuation', 'index'],
    lambda: []
  });

  VarTrace.prototype.equals = function(other) {
    if (this._tag !== other._tag) {
      return false;
    }
    return this.cases({
      value: function(val) {
        return val.equals(other.val);
      },
      continued: function(continuation, index) {
        return continuation === other.continuation && index === other.index;
      }
    });
  };

  return VarTrace;

})(Variant);

Trace = (function(_super) {
  __extends(Trace, _super);

  function Trace() {
    _ref12 = Trace.__super__.constructor.apply(this, arguments);
    return _ref12;
  }

  Trace.variants({
    empty: [],
    varTrace: ['parent', 'name', 'traces']
  });

  Trace.prototype.boundNames = function() {
    return this.cases({
      empty: function() {
        return [];
      },
      varTrace: function(parent, name, _) {
        return parent.boundNames().concat([name]);
      }
    });
  };

  Trace.prototype.extendWith = function(step) {
    var _this = this;
    return step.cases({
      "let": function(lval, value, _) {
        return _this.traceVar(lval, VarTrace.value(value));
      },
      letCont: function(contName, argNames, body, expr) {
        var i, name, traced, _i, _len;
        traced = _this;
        for (i = _i = 0, _len = argNames.length; _i < _len; i = ++_i) {
          name = argNames[i];
          traced = traced.traceVar(name, VarTrace.continued(contName, i));
        }
        return traced;
      },
      other: function() {
        return _this;
      }
    });
  };

  Trace.prototype.inspect = function() {
    return "<" + (this.boundNames().join(' ')) + ">";
  };

  Trace.prototype.traceVar = function(name, trace) {
    return Trace.varTrace(this, name, trace);
  };

  Trace.prototype.findVarTrace = function(needle) {
    return this.cases({
      empty: function() {
        return null;
      },
      varTrace: function(parent, name, trace) {
        if (needle.equals(trace)) {
          return name;
        } else {
          return parent.findVarTrace(needle);
        }
      }
    });
  };

  Trace.prototype.getVar = function(needle) {
    return this.cases({
      empty: function() {
        throw "no such variable " + needle;
      },
      varTrace: function(parent, name, subst) {
        if (name === needle) {
          return subst;
        } else {
          return parent.getVar(needle);
        }
      }
    });
  };

  return Trace;

})(Variant);

RVal = (function(_super) {
  __extends(RVal, _super);

  function RVal() {
    _ref13 = RVal.__super__.constructor.apply(this, arguments);
    return _ref13;
  }

  RVal.variants({
    constant: ['value'],
    global: [],
    lambda: ['args', 'rescue', 'next', 'body'],
    prim: ['arity', 'name', 'args'],
    list: ['elements'],
    project: ['val', 'index'],
    pair: ['first', 'second'],
    depair: ['val', 'key'],
    compact: ['val']
  });

  RVal.prototype.equals = function(other) {
    if (this._tag !== other._tag) {
      return false;
    }
    return this.cases({
      constant: function(val) {
        return val === other.value;
      },
      global: function() {
        return true;
      },
      lambda: function() {
        return false;
      },
      prim: function(arity, name, args) {
        return arity === other.arity && name === other.name && equalArrays(args, other.args);
      },
      list: function(elements) {
        return equalArrays(elements, other.elements);
      },
      project: function(val, index) {
        return val === other.val && index === other.index;
      },
      pair: function(first, second) {
        return first === other.first && second === other.second;
      },
      depair: function(val, key) {
        return val === other.val;
      },
      compact: function(val) {
        return val === other.val;
      }
    });
  };

  RVal.prototype.hasFree = function(varName) {
    return this.cases({
      lambda: function(args, rescue, next, body) {
        return __indexOf.call(args, varName) < 0 && (varName !== rescue && varName !== next) && body.hasFree(varName);
      },
      prim: function(_, __, args) {
        return __indexOf.call(args, varName) >= 0;
      },
      list: function(els) {
        return __indexOf.call(els, varName) >= 0;
      },
      project: function(val, index) {
        return varName === val || varName === index;
      },
      pair: function(first, second) {
        return varName === first || varName === second;
      },
      depair: function(val, key) {
        return varName === val;
      },
      compact: function(val) {
        return val === varName;
      },
      other: function() {
        return false;
      }
    });
  };

  RVal.prototype.subst = function(varName, target) {
    return this.cases({
      prim: function(arity, name, args) {
        var arg, newArgs;
        newArgs = (function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = args.length; _i < _len; _i++) {
            arg = args[_i];
            if (arg === varName) {
              _results.push(target);
            } else {
              _results.push(arg);
            }
          }
          return _results;
        })();
        return RVal.prim(arity, name, newArgs);
      },
      list: function(els) {
        var el, newEls;
        newEls = (function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = els.length; _i < _len; _i++) {
            el = els[_i];
            if (el === varName) {
              _results.push(target);
            } else {
              _results.push(el);
            }
          }
          return _results;
        })();
        return RVal.list(newEls);
      },
      project: function(val, index) {
        if (val === varName) {
          val = target;
        }
        if (index === varName) {
          index = target;
        }
        return RVal.project(val, index);
      },
      compact: function(val) {
        if (val === varName) {
          val = target;
        }
        return RVal.compact(val);
      },
      pair: function(first, second) {
        if (first === varName) {
          first = target;
        }
        if (second === varName) {
          second = target;
        }
        return RVal.pair(first, second);
      },
      depair: function(val, key) {
        if (val === varName) {
          val = target;
        }
        return RVal.depair(val, key);
      },
      lambda: function() {
        throw 'TODO';
      },
      other: function() {
        return this;
      }
    });
  };

  RVal.prototype.mapSteps = function(f) {
    return this.cases({
      lambda: function(a, r, n, b) {
        return RVal.lambda(a, r, n, f(b));
      },
      other: function() {
        return this;
      }
    });
  };

  RVal.makeLambda = function(argNames, f) {
    var body, nextName, rescueName;
    rescueName = nameGen('rescue');
    nextName = nameGen('next');
    body = f(rescueName, nextName);
    return RVal.lambda(argNames, rescueName, nextName, body);
  };

  RVal.prototype.inspect = function() {
    return this.cases({
      constant: function(value) {
        return inspectNative(value);
      },
      global: function() {
        return '$';
      },
      prim: function(arity, name, args) {
        return "(`" + name + "`/" + arity + " " + (args.join(' ')) + ")";
      },
      project: function(val, index) {
        return "" + val + "[" + index + "]";
      },
      lambda: function(args, rescue, next, body) {
        return "(\\" + (args.join(' ')) + " =>" + rescue + " =>" + next + " " + (body.inspect()) + ")";
      },
      compact: function(val) {
        return "(COMPACT " + val + ")";
      },
      pair: function(first, second) {
        return "(PAIR " + first + " " + second + ")";
      },
      depair: function(val, key) {
        return "" + val + "." + key;
      },
      list: function(els) {
        return "[" + (els.join(', ')) + "]";
      }
    });
  };

  return RVal;

})(Variant);

Gibbon.sequence = (function() {
  var bindExprs, sequence, sequenceTail;
  bindExprs = function(exprs, rescue, f) {
    var asyncExprs, asyncVars, bindAsyncVars, bound, collectionName, contName, expr, forkBodies, forks, i, idx, joinName, joinRescueName, name, recurse, syncExprs, syncStep, syncVars, _, _i, _len;
    syncExprs = [];
    asyncExprs = [];
    bound = [];
    for (idx = _i = 0, _len = exprs.length; _i < _len; idx = ++_i) {
      expr = exprs[idx];
      if (expr.isAsync()) {
        asyncExprs.push([idx, expr]);
      } else {
        syncExprs.push([idx, expr]);
      }
    }
    if (asyncExprs.length === 1) {
      syncExprs.push(asyncExprs[0]);
      asyncExprs = [];
    }
    syncVars = (function() {
      var _j, _len1, _ref14, _results;
      _results = [];
      for (_j = 0, _len1 = syncExprs.length; _j < _len1; _j++) {
        _ref14 = syncExprs[_j], idx = _ref14[0], expr = _ref14[1];
        name = nameGen('t');
        bound[idx] = name;
        _results.push(name);
      }
      return _results;
    })();
    asyncVars = (function() {
      var _j, _len1, _ref14, _results;
      _results = [];
      for (_j = 0, _len1 = asyncExprs.length; _j < _len1; _j++) {
        _ref14 = asyncExprs[_j], idx = _ref14[0], expr = _ref14[1];
        _results.push(bound[idx] = nameGen('t'));
      }
      return _results;
    })();
    syncStep = (recurse = function(i) {
      var expr_, idx_, _ref14;
      if (i >= syncExprs.length) {
        return f(bound);
      }
      _ref14 = syncExprs[i], idx_ = _ref14[0], expr_ = _ref14[1];
      return sequence(expr_, rescue, function(boundExpr) {
        bound[idx_] = boundExpr;
        return recurse(i + 1);
      });
    })(0);
    if (!asyncExprs.length) {
      return syncStep;
    }
    joinName = nameGen('j');
    joinRescueName = "" + joinName + "$$rescue";
    contName = nameGen('k');
    forkBodies = (function() {
      var _j, _len1, _ref14, _results;
      _results = [];
      for (i = _j = 0, _len1 = asyncExprs.length; _j < _len1; i = ++_j) {
        _ref14 = asyncExprs[i], _ = _ref14[0], expr = _ref14[1];
        _results.push(Step.makeVar(RVal.constant(i), function(boundI) {
          return sequence(expr, joinRescueName, function(boundExpr) {
            return Step.next(joinName, [boundI, boundExpr]);
          });
        }));
      }
      return _results;
    })();
    collectionName = nameGen('c');
    bindAsyncVars = (recurse = function(i) {
      if (i >= asyncVars.length) {
        return syncStep;
      }
      return sequence(Core.constant(i), rescue, function(boundIndex) {
        var projection;
        projection = RVal.project(collectionName, boundIndex);
        return Step["let"](asyncVars[i], projection, recurse(i + 1));
      });
    })(0);
    forks = (function() {
      var _j, _len1, _results;
      _results = [];
      for (_j = 0, _len1 = forkBodies.length; _j < _len1; _j++) {
        _ = forkBodies[_j];
        _results.push(nameGen('f'));
      }
      return _results;
    })();
    return Step.letCont(contName, [collectionName], bindAsyncVars, Step.makeVar(RVal.constant(asyncExprs.length), function(order) {
      return Step.letJoin(joinName, order, rescue, contName, (recurse = function(i) {
        if (i >= forkBodies.length) {
          return Step.fork(forks);
        } else {
          return Step.letCont(forks[i], [], forkBodies[i], recurse(i + 1));
        }
      })(0));
    }));
  };
  sequence = function(core, rescue, bind) {
    return core.cases({
      variable: function(name) {
        return bind(name);
      },
      constant: function(val) {
        return Step.makeVar(RVal.constant(val), bind);
      },
      global: function() {
        return Step.makeVar(RVal.global(), bind);
      },
      bind: function(varName, valExpr, expr) {
        return sequence(valExpr, rescue, function(bound) {
          return sequence(expr.subst(varName, Core.variable(bound)), rescue, bind);
        });
      },
      block: function(argName, body) {
        var lambda;
        lambda = RVal.makeLambda([argName], function(rescue, next) {
          return sequenceTail(body, rescue, next);
        });
        return Step.makeVar(lambda, bind);
      },
      app: function(block, arg) {
        return Step.makeCont(1, bind, function(cont) {
          return bindExprs([block, arg], rescue, function(_arg) {
            var boundArg, boundBlock;
            boundBlock = _arg[0], boundArg = _arg[1];
            return Step.app(boundBlock, [boundArg], rescue, cont);
          });
        });
      },
      len: function(expr) {
        return sequence(expr, rescue, function(boundExpr) {
          return Step.makeVar(RVal.prim(1, 'length', [boundExpr]), bind);
        });
      },
      op1: function(op, arg) {
        return sequence(arg, rescue, function(boundArg) {
          return Step.makeVar(RVal.prim(1, op, [boundArg]), bind);
        });
      },
      op2: function(op, lhs, rhs) {
        return bindExprs([lhs, rhs], rescue, function(_arg) {
          var l, r;
          l = _arg[0], r = _arg[1];
          return Step.makeVar(RVal.prim(2, op, [l, r]), bind);
        });
      },
      query: function(expr, annotations) {
        return sequence(expr, rescue, function(boundExpr) {
          return Step.makeCont(1, bind, function(outCont) {
            return Step.query(annotations, boundExpr, rescue, outCont);
          });
        });
      },
      localQuery: function(key) {
        return Step.makeCont(1, bind, function(outCont) {
          return Step.localQuery(key, rescue, outCont);
        });
      },
      branch: function(cond, ifTrue, ifFalse) {
        return sequence(cond, rescue, function(boundCond) {
          return Step.makeCont(1, bind, function(joinCont) {
            var falseBody, trueBody;
            trueBody = sequenceTail(ifTrue, rescue, joinCont);
            falseBody = sequenceTail(ifFalse, rescue, joinCont);
            return Step.makeCont(0, (function() {
              return trueBody;
            }), function(trueCont) {
              return Step.makeCont(0, (function() {
                return falseBody;
              }), function(falseCont) {
                return Step["if"](boundCond, trueCont, falseCont);
              });
            });
          });
        });
      },
      fail: function(message) {
        return Step.makeVar(RVal.constant(message), function(boundMessage) {
          return Step.next(rescue, [boundMessage]);
        });
      },
      pair: function(first, second) {
        return bindExprs([first, second], rescue, function(_arg) {
          var f, s;
          f = _arg[0], s = _arg[1];
          return Step.makeVar(RVal.pair(f, s), bind);
        });
      },
      list: function(elements) {
        return bindExprs(elements, rescue, function(boundEls) {
          return Step.makeVar(RVal.list(boundEls), bind);
        });
      },
      squishList: function(list) {
        return list.cases({
          list: function(elements) {
            var NULL, e, rescued;
            NULL = Core.constant(null);
            rescued = (function() {
              var _i, _len, _results;
              _results = [];
              for (_i = 0, _len = elements.length; _i < _len; _i++) {
                e = elements[_i];
                _results.push(e.rescue(NULL));
              }
              return _results;
            })();
            return bindExprs(rescued, rescue, function(boundExprs) {
              return Step.makeVar(RVal.list(boundExprs), function(boundList) {
                return Step.makeVar(RVal.compact(boundList), bind);
              });
            });
          },
          other: function() {
            return sequence(list, rescue, function(boundList) {
              return Step.makeVar(RVal.compact(boundList), bind);
            });
          }
        });
      },
      mapList: function(list, arg, idxArg, body) {
        var joinName;
        joinName = nameGen('j');
        return sequence(list, rescue, function(boundList) {
          return Step.makeVar(RVal.prim(1, 'length', [boundList]), function(boundLen) {
            return Step.makeCont(1, bind, function(outCont) {
              return Step.makeJoin(boundLen, rescue, outCont, function(index, joinRescue, bindJoin) {
                var delistExpr, substBody;
                delistExpr = Core.variable(boundList).delist(Core.variable(index));
                substBody = body.subst(arg, delistExpr).subst(idxArg, Core.variable(index));
                return sequence(substBody, joinRescue, bindJoin);
              });
            });
          });
        });
      },
      filterList: function(list, arg, body) {
        var joinName, nullName;
        joinName = nameGen('j');
        nullName = nameGen('NULL');
        return sequence(list, rescue, function(boundList) {
          return Step["let"](nullName, RVal.constant(null), Step.makeVar(RVal.prim(1, 'length', [boundList]), function(boundLen) {
            var mkCompact;
            mkCompact = function(v) {
              return Step.makeVar(RVal.compact(v), bind);
            };
            return Step.makeCont(1, mkCompact, function(outCont) {
              return Step.makeJoin(boundLen, rescue, outCont, function(index, joinRescue, bindJoin) {
                var delistExpr, substBody;
                delistExpr = Core.variable(boundList).delist(Core.variable(index));
                substBody = body.subst(arg, delistExpr);
                return sequence(substBody, joinRescue, function(mappedBool) {
                  var mkDelete, mkKeep;
                  mkDelete = function() {
                    return bindJoin(nullName);
                  };
                  mkKeep = function() {
                    return sequence(delistExpr, joinRescue, bindJoin);
                  };
                  return Step.makeCont(0, mkDelete, function(deleteCont) {
                    return Step.makeCont(0, mkKeep, function(keepCont) {
                      return Step["if"](mappedBool, keepCont, deleteCont);
                    });
                  });
                });
              });
            });
          }));
        });
      },
      delist: function(expr, idxExpr) {
        return bindExprs([expr, idxExpr], rescue, function(_arg) {
          var boundExpr, boundIdx, e;
          boundExpr = _arg[0], boundIdx = _arg[1];
          e = nameGen('e');
          return Step["let"](e, RVal.project(boundExpr, boundIdx), bind(e));
        });
      },
      depair: function(expr, key) {
        return sequence(expr, rescue, function(boundExpr) {
          return Step.makeVar(RVal.depair(boundExpr, key), bind);
        });
      },
      rescue: function(expr, default_) {
        return Step.makeCont(1, bind, function(joinCont) {
          var defaultBody;
          defaultBody = sequenceTail(default_, rescue, joinCont);
          return Step.makeCont(0, (function() {
            return defaultBody;
          }), function(innerRescue) {
            return sequenceTail(expr, innerRescue, joinCont);
          });
        });
      },
      foldList: function(list, out, arg, accumArg, idxArg, body) {
        var v;
        v = Core.variable;
        if (body.isStrictIn(Core.variable(accumArg))) {
          return sequence(list, rescue, function(boundList) {
            return sequence(out, rescue, function(boundOut) {
              var decrIdx, lenExpr, loopName;
              loopName = nameGen('loop');
              decrIdx = Core.variable(idxArg).op2('-', Core.constant(1));
              lenExpr = Core.variable(boundList).len();
              return sequence(lenExpr, rescue, function(boundLen) {
                var escapeCond, loopBody;
                escapeCond = Core.variable(idxArg).op2('===', Core.constant(0));
                loopBody = sequence(escapeCond, rescue, function(boundEscape) {
                  var continueBody, escapeBody;
                  escapeBody = function() {
                    return bind(accumArg);
                  };
                  continueBody = function() {
                    return sequence(decrIdx, rescue, function(nextIdx) {
                      var substBody;
                      substBody = body.subst(arg, Core.delist(v(boundList), v(nextIdx))).subst(idxArg, Core.variable(nextIdx));
                      return sequence(substBody, rescue, function(nextAccum) {
                        return Step.next(loopName, [nextIdx, nextAccum]);
                      });
                    });
                  };
                  return Step.makeCont(0, escapeBody, function(escapeCont) {
                    return Step.makeCont(0, continueBody, function(continueCont) {
                      return Step["if"](boundEscape, escapeCont, continueCont);
                    });
                  });
                });
                return Step.letCont(loopName, [idxArg, accumArg], loopBody, Step.next(loopName, [boundLen, boundOut]));
              });
            });
          });
        } else if (!body.containsInNonTailPosition(Core.variable(accumArg))) {
          return sequence(list, rescue, function(boundList) {
            var lenExpr;
            lenExpr = Core.variable(boundList).len();
            return sequence(lenExpr, rescue, function(boundLen) {
              return Step.makeCont(1, bind, function(outCont) {
                var escapeBody, loopBody, loopName, processBody, testExpr;
                loopName = nameGen('l');
                escapeBody = function() {
                  return sequenceTail(out, rescue, outCont);
                };
                processBody = function() {
                  return sequence(v(idxArg).op2('+', Core.constant(1)), rescue, function(incr) {
                    var substBody;
                    substBody = body.subst(arg, Core.delist(v(boundList), v(idxArg))).subst(accumArg, Core.next(loopName, [incr]));
                    return sequenceTail(substBody, rescue, outCont);
                  });
                };
                testExpr = v(idxArg).op2('<', v(boundLen));
                loopBody = Step.makeCont(0, escapeBody, function(escape) {
                  return Step.makeCont(0, processBody, function(process) {
                    return sequence(testExpr, rescue, function(test) {
                      return Step["if"](test, process, escape);
                    });
                  });
                });
                return Step.letCont(loopName, [idxArg], loopBody, Step.makeVar(RVal.constant(0), function(zero) {
                  return Step.next(loopName, [zero]);
                }));
              });
            });
          });
        } else {
          debugger;
          body.isStrictIn(accumArg);
          throw 'TODO';
        }
      }
    });
  };
  sequenceTail = function(core, rescue, next) {
    return core.cases({
      next: function(cont, args) {
        return Step.next(cont, args);
      },
      other: function() {
        return sequence(core, rescue, function(bound) {
          return Step.next(next, [bound]);
        });
      }
    });
  };
  return function(core) {
    return sequenceTail(core, 'FAIL', 'RETURN');
  };
})();

Gibbon.reduce = (function() {
  var betaReduce, reduceWithTrace;
  betaReduce = function(name, params, body, expr) {
    return expr.cases({
      next: function(contName, args) {
        if (name === contName) {
          
          return body.substAll(params, args);
        } else {
          return this;
        }
      },
      other: function() {
        return this.map(function(x) {
          return betaReduce(name, params, body, x);
        });
      }
    });
  };
  reduceWithTrace = function(step, trace) {
    return step.cases({
      "let": function(lval, value, expr) {
        var checkDup, goAbort, goConst, goSubst;
        checkDup = function(val) {
          var dupVar;
          dupVar = trace.findVarTrace(value);
          if (dupVar) {
            
            return reduceWithTrace(expr.subst(lval, dupVar), trace);
          }
        };
        goSubst = function(varName) {
          return reduceWithTrace(expr.subst(lval, varName), trace);
        };
        goConst = function(c) {
          var constVal, dup, newTrace;
          constVal = RVal.constant(c);
          if ((dup = checkDup(constVal))) {
            return dup;
          }
          newTrace = trace.traceVar(lval, VarTrace.value(constVal));
          return Step["let"](lval, constVal, reduceWithTrace(expr, newTrace));
        };
        goAbort = function() {
          var dup, reduced;
          if ((dup = checkDup(value))) {
            return dup;
          }
          reduced = reduceWithTrace(expr, trace.extendWith(step));
          if (reduced.hasFree(lval)) {
            return Step["let"](lval, value, reduced);
          } else {
            
            return reduced;
          }
        };
        return value.cases({
          prim: function(arity, op, args) {
            var checkIdent, constFold, identFold, left, leftTrace, leftVal, right, rightTrace, rightVal, vTrace;
            if (arity === 1) {
              vTrace = trace.getVar(args[0]);
              if (vTrace._tag === 'value' && vTrace.val._tag === 'constant') {
                return goConst(applyOp1(op, vTrace.val.value));
              } else {
                return goAbort();
              }
            } else if (arity === 2) {
              left = args[0], right = args[1];
              leftTrace = trace.getVar(left);
              rightTrace = trace.getVar(right);
              leftVal = leftTrace._tag === 'value' && leftTrace.val;
              rightVal = rightTrace._tag === 'value' && rightTrace.val;
              checkIdent = function(opTest, val, ident, identVal) {
                return op === opTest && val && val._tag === 'constant' && val.value === ident && identVal();
              };
              identFold = checkIdent('*', leftVal, 0, function() {
                return goConst(0);
              }) || checkIdent('*', rightVal, 0, function() {
                return goConst(0);
              }) || checkIdent('*', leftVal, 1, function() {
                return goSubst(right);
              }) || checkIdent('*', rightVal, 1, function() {
                return goSubst(left);
              }) || checkIdent('+', leftVal, 0, function() {
                return goSubst(right);
              }) || checkIdent('+', rightVal, 0, function() {
                return goSubst(left);
              }) || checkIdent('/', rightVal, 1, function() {
                return goSubst(left);
              });
              if (identFold) {
                
                return identFold;
              }
              if (leftVal && leftVal._tag === 'constant' && rightVal && rightVal._tag === 'constant') {
                constFold = applyOp2(op, leftVal.value, rightVal.value);
                
                return goConst(constFold);
              }
              return goAbort();
            }
          },
          other: function() {
            return goAbort();
          }
        });
      },
      letCont: function(contName, argNames, body, expr) {
        var extended, reducedBody, tryBeta;
        extended = trace.extendWith(this);
        tryBeta = function() {
          var betaReduced, reduced;
          if (reducedBody.hasFree(contName)) {
            
            betaReduced = expr;
          } else {
            betaReduced = betaReduce(contName, argNames, reducedBody, expr);
          }
          reduced = reduceWithTrace(betaReduced, extended);
          if (!reduced.hasFree(contName)) {
            
            return reduced;
          }
          return Step.letCont(contName, argNames, reducedBody, reduced);
        };
        reducedBody = reduceWithTrace(body, extended);
        return reducedBody.cases({
          next: function(innerName, innerArgs) {
            if (equalArrays(innerArgs, argNames)) {
              
              return reduceWithTrace(expr.subst(contName, innerName), trace);
            } else {
              return tryBeta();
            }
          },
          other: function() {
            return tryBeta();
          }
        });
      },
      other: function() {
        var _this = this;
        return this.map(function(x) {
          return reduceWithTrace(x, trace.extendWith(_this));
        });
      }
    });
  };
  return function(step) {
    var reduced;
    
    
    
    reduced = reduceWithTrace(step, Trace.empty());
    
    
    return reduced;
  };
})();

Gibbon.JS = JS = (function(_super) {
  var inspectString, validIdent;

  __extends(JS, _super);

  function JS() {
    _ref14 = JS.__super__.constructor.apply(this, arguments);
    return _ref14;
  }

  JS.variants({
    func: ['name', 'args', 'block'],
    json: ['obj'],
    block: ['statements'],
    ident: ['name'],
    funcall: ['callee', 'args'],
    literal: ['value'],
    array: ['elements'],
    object: ['keys', 'vals'],
    access: ['expr', 'name'],
    bind: ['lhs', 'rhs'],
    ternary: ['cond', 'ifTrue', 'ifFalse'],
    "if": ['cond', 'ifTrue', 'ifFalse'],
    "return": ['expr'],
    operator: ['operator', 'lhs', 'rhs'],
    forLoop: ['len', 'arg', 'body'],
    whileLoop: ['cond', 'body'],
    varDecl: ['name']
  });

  JS.prototype.toFunction = function() {
    return this.cases({
      func: function(name, args, block) {
        return (function(func, args, ctor) {
          ctor.prototype = func.prototype;
          var child = new ctor, result = func.apply(child, args);
          return Object(result) === result ? result : child;
        })(Function, __slice.call(args).concat([block.toJS()]), function(){});
      },
      other: function() {
        return JS.func('tmp', [], this).toFunction();
      }
    });
  };

  JS.trap = function(cond) {
    return JS["if"](cond, JS["return"](null), null);
  };

  JS.iife = function(statements) {
    return JS.funcall(JS.func(null, [], JS.block(statements)), []);
  };

  JS.tailcall = function(fn, args) {
    return JS["return"](JS.funcall(fn, args));
  };

  JS.prototype.op = function(o, other) {
    return JS.operator(o, this, other);
  };

  JS.prototype.eq = function(other) {
    return this.op('===', other);
  };

  JS.prototype.lt = function(other) {
    return this.op('<', other);
  };

  JS.prototype.funcall = function(args) {
    return JS.funcall(this, args);
  };

  JS.prototype.tailcall = function(args) {
    return JS.tailcall(this, args);
  };

  JS.prototype.methodcall = function(name, args) {
    return this.access(JS.literal(name)).funcall(args);
  };

  JS.prototype.access = function(key) {
    return JS.access(this, key);
  };

  JS.trampoline = function(varName) {
    var cond, v;
    v = JS.ident(varName);
    cond = JS.ident('typeof').funcall([v]).op('===', JS.literal('function'));
    return JS.whileLoop(cond, JS.bind(v, v.funcall([])));
  };

  inspectString = function(str) {
    var escaped;
    escaped = str.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n");
    return "\"" + escaped + "\"";
  };

  JS.prototype.inspect = function() {
    return "[JS " + (this.toJS()) + "]";
  };

  validIdent = /^[\w$][\w\d$]*$/;

  JS.prototype.toJS = function(indent, block) {
    var I, i;
    if (indent == null) {
      indent = 0;
    }
    i = Array(indent + 1).join('  ');
    I = block ? i : '';
    return this.cases({
      func: function(name, args, block) {
        var header;
        header = name ? "function " + name : "function";
        return "" + I + header + "(" + (args.join(', ')) + ") " + (block.toJS(indent));
      },
      json: function(obj) {
        return JSON.stringify(obj);
      },
      ident: function(name) {
        return name;
      },
      array: function(els) {
        var e;
        return "" + I + "[" + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = els.length; _i < _len; _i++) {
            e = els[_i];
            _results.push(e.toJS(indent));
          }
          return _results;
        })()).join(', ')) + "]";
      },
      object: function(keys, vals) {
        var k, pairs;
        pairs = (function() {
          var _i, _len, _results;
          _results = [];
          for (i = _i = 0, _len = keys.length; _i < _len; i = ++_i) {
            k = keys[i];
            _results.push("" + (inspectString(k)) + ": " + (vals[i].toJS()));
          }
          return _results;
        })();
        return "" + I + "{ " + (pairs.join(', ')) + " }";
      },
      funcall: function(callee, args) {
        var a;
        args = ((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = args.length; _i < _len; _i++) {
            a = args[_i];
            _results.push(a.toJS(indent));
          }
          return _results;
        })()).join(', ');
        return "" + I + (callee.toJS(indent)) + "(" + args + ")";
      },
      literal: function(value) {
        if (typeof value === 'string') {
          return inspectString(value);
        }
        return '' + value;
      },
      "if": function(cond, ifTrue, ifFalse) {
        var elseBranch;
        elseBranch = "";
        if (ifFalse) {
          elseBranch = "\n" + i + "else " + (ifFalse.toJS(indent));
        }
        return "" + I + "if (" + (cond.toJS(indent, true)) + ") " + (ifTrue.toJS(indent)) + elseBranch;
      },
      block: function(statements) {
        var s;
        return "" + I + "{\n" + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = statements.length; _i < _len; _i++) {
            s = statements[_i];
            _results.push(s.toJS(indent + 1, true) + ';');
          }
          return _results;
        })()).join('\n')) + "\n" + i + "}";
      },
      forLoop: function(len, arg, body) {
        arg = arg.toJS(indent);
        len = len.toJS(indent);
        body = body.toJS(indent);
        return "" + i + "for (var " + arg + "=0; " + arg + "<" + len + "; " + arg + "+=1) " + body;
      },
      whileLoop: function(cond, body) {
        return "" + I + "while (" + (cond.toJS(indent)) + ") " + (body.toJS(indent));
      },
      varDecl: function(name) {
        return "" + i + "var " + name;
      },
      access: function(expr, name) {
        var access;
        access = name._tag === 'literal' && typeof name.value === 'string' && validIdent.test(name.value) ? "." + name.value : "[" + (name.toJS(indent)) + "]";
        return "" + (expr.toJS(indent)) + access;
      },
      bind: function(lhs, rhs) {
        return "" + i + (lhs.toJS(indent)) + " = " + (rhs.toJS(indent));
      },
      "return": function(expr) {
        if (expr) {
          return "" + I + "return " + (expr.toJS(indent));
        } else {
          return "" + I + "return";
        }
      },
      operator: function(op, lhs, rhs) {
        return "(" + (lhs.toJS(indent)) + ")" + op + "(" + (rhs.toJS(indent)) + ")";
      }
    });
  };

  return JS;

})(Variant);

Gibbon.codegen = (function() {
  var generate, inlinePrim;
  inlinePrim = {
    2: {
      '+': function(_arg) {
        var l, r;
        l = _arg[0], r = _arg[1];
        return l.op('+', r);
      },
      '*': function(_arg) {
        var l, r;
        l = _arg[0], r = _arg[1];
        return l.op('*', r);
      },
      '-': function(_arg) {
        var l, r;
        l = _arg[0], r = _arg[1];
        return l.op('-', r);
      },
      '/': function(_arg) {
        var l, r;
        l = _arg[0], r = _arg[1];
        return l.op('/', r);
      },
      '<': function(_arg) {
        var l, r;
        l = _arg[0], r = _arg[1];
        return l.op('<', r);
      },
      '<=': function(_arg) {
        var l, r;
        l = _arg[0], r = _arg[1];
        return l.op('<=', r);
      },
      '>': function(_arg) {
        var l, r;
        l = _arg[0], r = _arg[1];
        return l.op('>', r);
      },
      '>=': function(_arg) {
        var l, r;
        l = _arg[0], r = _arg[1];
        return l.op('>=', r);
      },
      '===': function(_arg) {
        var l, r;
        l = _arg[0], r = _arg[1];
        return l.op('===', r);
      }
    },
    1: {
      length: function(_arg) {
        var l;
        l = _arg[0];
        return l.access(JS.literal('length'));
      },
      '!': function(_arg) {
        var a;
        a = _arg[0];
        return JS.funcall(JS.ident('!'), [a]);
      },
      '-': function(_arg) {
        var a;
        a = _arg[0];
        return JS.funcall(JS.ident('-'), [a]);
      }
    }
  };
  generate = function(term, trace, push) {
    var extended, varToJS;
    varToJS = function(varName) {
      return trace.getVar(varName).cases({
        value: function(val) {
          return val.cases({
            constant: function(v) {
              return JS.literal(v);
            },
            global: function() {
              return JS.ident('$');
            },
            lambda: function(args, rescue, next, body) {
              var arg, bodyTrace, lambdaStatements, _i, _len;
              lambdaStatements = [];
              bodyTrace = trace;
              for (_i = 0, _len = args.length; _i < _len; _i++) {
                arg = args[_i];
                bodyTrace = bodyTrace.traceVar(arg, VarTrace.lambda());
              }
              generate(body, bodyTrace, function(statement) {
                return lambdaStatements.push(statement);
              });
              return JS.func(null, __slice.call(args).concat([rescue], [next]), JS.block(lambdaStatements));
            },
            prim: function(arity, name, args) {
              var a, jsArgs;
              jsArgs = (function() {
                var _i, _len, _results;
                _results = [];
                for (_i = 0, _len = args.length; _i < _len; _i++) {
                  a = args[_i];
                  _results.push(varToJS(a));
                }
                return _results;
              })();
              return inlinePrim[arity][name](jsArgs);
            },
            list: function(els) {
              var e;
              return JS.array((function() {
                var _i, _len, _results;
                _results = [];
                for (_i = 0, _len = els.length; _i < _len; _i++) {
                  e = els[_i];
                  _results.push(varToJS(e));
                }
                return _results;
              })());
            },
            pair: function(first, second) {
              return JS.object(['first', 'second'], [varToJS(first), varToJS(second)]);
            },
            depair: function(val, key) {
              return varToJS(val).access(JS.literal(key));
            },
            project: function(val, index) {
              return varToJS(val).access(varToJS(index));
            },
            compact: function() {
              return JS.ident(varName);
            }
          });
        },
        other: function() {
          return JS.ident(varName);
        }
      });
    };
    extended = trace.extendWith(term);
    return term.cases({
      "let": function(name, val, expr) {
        var _compact, _i, _len, _push;
        if (val._tag === 'compact') {
          val = varToJS(val.val);
          _i = JS.ident('_i');
          _compact = JS.ident('_compact');
          _len = JS.ident('_len');
          _push = JS.access(_compact, JS.literal('push'));
          push(JS.varDecl(name));
          push(JS.bind(JS.ident(name), JS.iife([JS.varDecl('_compact'), JS.varDecl('_len'), JS.bind(_len, JS.access(val, JS.literal('length'))), JS.bind(_compact, JS.array([])), JS.forLoop(_len, _i, JS.block([JS["if"](JS.access(val, _i).op('!=', JS.literal(null)), JS.funcall(_push, [JS.access(val, _i)]), null)])), JS["return"](_compact)])));
        }
        return generate(expr, extended, push);
      },
      letCont: function(name, args, body, expr) {
        var bodyStatements;
        bodyStatements = [];
        generate(body, extended, function(s) {
          return bodyStatements.push(s);
        });
        push(JS.func(name, args, JS.block(bodyStatements)));
        return generate(expr, extended, push);
      },
      letJoin: function(name, order, rescue, cont, expr) {
        var counterName, rescueName, resultsName;
        counterName = "" + name + "$counter";
        resultsName = "" + name + "$results";
        rescueName = "" + name + "$$rescue";
        push(JS.varDecl(counterName));
        push(JS.varDecl(resultsName));
        push(JS.bind(JS.ident(counterName), varToJS(order)));
        push(JS.bind(JS.ident(resultsName), JS.array([])));
        push(JS.func(name, ['idx', 'el'], JS.block([JS.bind(JS.access(JS.ident(resultsName), JS.ident('idx')), JS.ident('el')), JS.trap(JS.ident(counterName).op('-=', JS.literal(1)).op('!==', JS.literal(0))), JS.ident(cont).tailcall([JS.ident(resultsName)])])));
        push(JS.func(rescueName, ['err'], JS.block([JS.trap(JS.ident(counterName).op('<', JS.literal(0))), JS.bind(JS.ident(counterName), JS.literal(-1)), JS.ident(rescue).tailcall([JS.ident('err')])])));
        return generate(expr, extended, push);
      },
      fork: function(forks) {
        var cont, head, last, thunk, _i, _j, _len;
        head = 2 <= forks.length ? __slice.call(forks, 0, _i = forks.length - 1) : (_i = 0, []), last = forks[_i++];
        thunk = nameGen('_thunk');
        push(JS.varDecl(thunk));
        for (_j = 0, _len = head.length; _j < _len; _j++) {
          cont = head[_j];
          push(JS.bind(JS.ident(thunk), JS.ident(cont).funcall([])));
          push(JS.trampoline(thunk));
        }
        return push(JS.ident(last).tailcall([]));
      },
      each: function(length, cont) {
        var minus1, thunk, _i;
        _i = JS.ident('_i');
        thunk = nameGen('_thunk');
        push(JS.varDecl(thunk));
        minus1 = varToJS(length).op('+', JS.literal(-1));
        push(JS.forLoop(minus1, _i, JS.block([JS.bind(JS.ident(thunk), JS.ident(cont).funcall([_i])), JS.trampoline(thunk)])));
        return push(JS.ident(cont).tailcall([minus1]));
      },
      next: function(cont, args) {
        var a;
        return push(JS.ident(cont).tailcall((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = args.length; _i < _len; _i++) {
            a = args[_i];
            _results.push(varToJS(a));
          }
          return _results;
        })()));
      },
      app: function(fn, args, rescue, next) {
        var a;
        args = (function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = args.length; _i < _len; _i++) {
            a = args[_i];
            _results.push(varToJS(a));
          }
          return _results;
        })();
        return push(varToJS(fn).tailcall(__slice.call(args).concat([JS.ident(rescue)], [JS.ident(next)])));
      },
      query: function(annotations, arg, rescue, next) {
        return push(JS.ident('QUERY').tailcall([varToJS(arg), JS.json(annotations), JS.ident(rescue), JS.ident(next)]));
      },
      localQuery: function(key, rescue, next) {
        return push(JS.ident('QUERY').tailcall([JS.literal(null), JS.literal(key), JS.ident(rescue), JS.ident(next)]));
      },
      "if": function(cond, trueCont, falseCont) {
        return push(JS["if"](varToJS(cond), JS.ident(trueCont).tailcall([]), JS.ident(falseCont).tailcall([])));
      }
    });
  };
  return function(term) {
    var out, statements;
    statements = [];
    generate(term, Trace.empty(), function(s) {
      return statements.push(s);
    });
    out = JS.func('compiled', ['$', 'QUERY', 'FAIL', 'RETURN'], JS.block(statements));
    
    
    return out;
  };
})();

stdlib = Gibbon.stdlib = (function() {
  var FALSE, TRUE, ZERO, equals, isEmpty;
  TRUE = Core.constant(true);
  FALSE = Core.constant(false);
  ZERO = Core.constant(0);
  isEmpty = function(list) {
    return list.len().op2('===', ZERO);
  };
  equals = function(x, y, type) {
    var direct;
    direct = function() {
      return x.op2('===', y);
    };
    return type.cases({
      entity: direct,
      numeric: direct,
      string: direct,
      bool: direct,
      block: function() {
        return FALSE;
      },
      pair: function() {
        var eq1, eq2;
        eq1 = equals(x.depair('first'), y.depair('first'), type.first);
        eq2 = equals(x.depair('first'), y.depair('second'), type.second);
        return eq1.branch(eq2, FALSE);
      },
      list: function() {
        var eqEls, eqLength;
        eqLength = equals(x.len(), y.len(), Type.numeric());
        eqEls = x.zipList(y).foldList(TRUE, function(pair, next) {
          var eq;
          eq = equals(pair.depair('first'), pair.depair('second'), type.of);
          return next.branch(FALSE, eq);
        });
        return eqLength.branch(eqEls, FALSE);
      }
    });
  };
  return {
    "case": {
      type: parse.type('case [bool : %b] = % -> %b'),
      compile: function(_, _arg) {
        var alts;
        alts = _arg[0];
        return alts.foldList(Core.fail('non-exhaustive cases'), function(el, next) {
          return el.depair('first').branch(el.depair('second'), next);
        });
      }
    },
    "case-eq": {
      type: parse.type('case-eq [%a : %b] = %a -> %b'),
      compile: function(input, _arg, tvars) {
        var alts, eqType;
        alts = _arg[0];
        eqType = tvars.get('a');
        return alts.foldList(Core.fail('non-exhaustive cases'), function(el, next) {
          var first, second;
          first = el.depair('first');
          second = el.depair('second');
          return equals(input, first, eqType).branch(second, next);
        });
      }
    },
    "case-eq-default": {
      type: parse.type('case-eq-default %b [%a : %b] = %a -> %b'),
      compile: function(input, _arg, tvars) {
        var alts, default_, eqType;
        default_ = _arg[0], alts = _arg[1];
        eqType = tvars.get('a');
        return alts.foldList(default_, function(el, next) {
          var first, second;
          first = el.depair('first');
          second = el.depair('second');
          return equals(input, first, eqType).branch(second, next);
        });
      }
    },
    "bucket": {
      type: parse.type('bucket [numeric : %b] = numeric -> %b'),
      compile: function(input, _arg) {
        var default_, partitions;
        partitions = _arg[0];
        default_ = Core.fail('bucket: exceeded the last bucket');
        return partitions.foldList(default_, function(pair, next) {
          var boundary, result;
          boundary = pair.depair('first');
          result = pair.depair('second');
          return input.op2('<=', boundary).branch(result, next);
        });
      }
    },
    "any-true?": {
      type: parse.type('any-true? = [bool] -> bool'),
      compile: function(list) {
        return list.foldList(FALSE, function(el, next) {
          return el.branch(TRUE, next);
        });
      }
    },
    "all-true?": {
      type: parse.type('all-true? = [bool] -> bool'),
      compile: function(list) {
        return list.foldList(TRUE, function(el, next) {
          return el.branch(next, FALSE);
        });
      }
    },
    "any?": {
      type: parse.type('any? { %a -> bool } = [%a] -> bool'),
      compile: function(list, _arg) {
        var block;
        block = _arg[0];
        return list.foldList(FALSE, function(el, next) {
          return block.app(el).branch(TRUE, next);
        });
      }
    },
    "all?": {
      type: parse.type('all? { %a -> bool } = [%a] -> bool'),
      compile: function(list, _arg) {
        var block;
        block = _arg[0];
        return list.foldList(TRUE, function(el, next) {
          return block.app(el).branch(next, FALSE);
        });
      }
    },
    "include?": {
      type: parse.type('include? %a = [%a] -> bool'),
      compile: function(list, _arg, tvars) {
        var elType, needle;
        needle = _arg[0];
        elType = tvars.get('a');
        return list.foldList(FALSE, function(el, next) {
          return next.branch(TRUE, equals(el, needle, elType));
        });
      }
    },
    "empty?": {
      type: parse.type('empty? = [%] -> bool'),
      compile: isEmpty
    },
    missing: {
      type: parse.type('empty = % -> %a'),
      compile: function() {
        return Core.fail('missing');
      }
    },
    assert: {
      type: parse.type('assert { %a -> bool } = %a -> %a'),
      compile: function(input, _arg) {
        var cond;
        cond = _arg[0];
        return cond.app(input).branch(input, Core.fail('assertion failed'));
      }
    },
    "assert-any": {
      type: parse.type('assert-any = [%a] -> [%a]'),
      compile: function(input, _arg) {
        var cond;
        cond = _arg[0];
        return input.len().op2('>', Core.constant(0)).branch(input, Core.fail('empty list'));
      }
    },
    blank: {
      type: parse.type('blank = % -> %a'),
      compile: function() {
        return Core.fail('blank');
      }
    },
    weight: {
      type: parse.type('weight [numeric : numeric] = % -> numeric'),
      compile: function(_, _arg) {
        var ratio, totalDenom, totalNum, weights, _ref15;
        weights = _arg[0];
        ratio = weights.foldList(Core.pair(ZERO, ZERO), function(el, next) {
          var denominator, numerator, value, weight, weighted, _ref15, _ref16;
          _ref15 = el.depair(), value = _ref15[0], weight = _ref15[1];
          _ref16 = next.depair(), numerator = _ref16[0], denominator = _ref16[1];
          weighted = value.op2('*', weight);
          return Core.pair(numerator.op2('+', weighted), denominator.op2('+', weight));
        });
        _ref15 = ratio.depair(), totalNum = _ref15[0], totalDenom = _ref15[1];
        totalDenom = totalDenom.failIf('weight: zero denominator', function(d) {
          return d.op2('===', ZERO);
        });
        return totalNum.op2('/', totalDenom);
      }
    },
    mean: {
      type: parse.type('mean = [numeric] -> numeric'),
      compile: function(list) {
        var sum;
        list = list.failIf('mean: empty list', isEmpty);
        sum = list.foldList(ZERO, function(el, next) {
          return el.op2('+', next);
        });
        return sum.op2('/', list.len());
      }
    },
    filter: {
      type: parse.type('filter { %a -> bool } = [%a] -> [%a]'),
      compile: function(input, _arg) {
        var block;
        block = _arg[0];
        return input.filterList(function(el) {
          return block.app(el);
        });
      }
    },
    scale: {
      type: parse.type('scale (numeric:numeric) (numeric:numeric) = numeric -> numeric'),
      compile: function(input, _arg) {
        var dom, domHigh, domLow, domSize, range, rangeHigh, rangeLow, rangeSize, retranslated, scaled, translated;
        dom = _arg[0], range = _arg[1];
        domLow = dom.depair('first');
        domHigh = dom.depair('second');
        rangeLow = range.depair('first');
        rangeHigh = range.depair('second');
        input = input.op2('<', domLow).branch(domLow, input);
        input = input.op2('>', domHigh).branch(domHigh, input);
        domSize = domHigh.op2('+', domLow.op1('-'));
        rangeSize = rangeHigh.op2('+', rangeLow.op1('-'));
        translated = input.op2('+', domLow.op1('-'));
        scaled = translated.op2('*', rangeSize.op2('/', domSize));
        retranslated = scaled.op2('+', rangeLow);
        return retranslated;
      }
    },
    map: {
      type: parse.type('map { %a -> %b } = [%a] -> [%b]'),
      compile: function(list, _arg) {
        var block;
        block = _arg[0];
        return list.mapList(function(el) {
          return block.app(el);
        });
      }
    },
    count: {
      type: parse.type('count = [%a] -> numeric'),
      compile: function(list) {
        return list.len();
      }
    },
    sum: {
      type: parse.type('sum = [numeric] -> numeric'),
      compile: function(list) {
        return list.foldList(ZERO, function(el, next) {
          return el.op2('+', next);
        });
      }
    },
    max: {
      type: parse.type('max = [numeric] -> numeric'),
      compile: function(list) {
        list = list.failIf('max: empty list', isEmpty);
        return list.foldList(Core.constant(-Infinity), function(el, next) {
          return el.op2('>', next).branch(el, next);
        });
      }
    },
    min: {
      type: parse.type('min = [numeric] -> numeric'),
      compile: function(list) {
        list = list.failIf('min: empty list', isEmpty);
        return list.foldList(Core.constant(Infinity), function(el, next) {
          return el.op2('<', next).branch(el, next);
        });
      }
    },
    "case-sum": {
      type: parse.type('case-sum [bool : numeric] = % -> numeric'),
      compile: function(_, _arg) {
        var list;
        list = _arg[0];
        return list.foldList(ZERO, function(el, next) {
          var cond, val;
          cond = el.depair('first');
          val = el.depair('second');
          return cond.branch(val.op2('+', next), next);
        });
      }
    },
    first: {
      type: parse.type('first = [%a] -> %a'),
      compile: function(list) {
        return Core.len(list).op2('===', ZERO).branch(Core.fail('first: empty list'), list.delist(ZERO));
      }
    },
    left: {
      type: parse.type('left = (%a : %b) -> %a'),
      compile: function(pair) {
        return pair.depair('first');
      }
    },
    right: {
      type: parse.type('right = (%a : %b) -> %b'),
      compile: function(pair) {
        return pair.depair('second');
      }
    },
    at: {
      type: parse.type('at numeric = [%a] -> %a'),
      compile: function(list, _arg) {
        var index;
        index = _arg[0];
        index = index.failIf('index out of bounds', function(i) {
          return list.len().op2('<=', i);
        });
        index = index.failIf('index must be non-negative', function(i) {
          return i.op2('<', ZERO);
        });
        return list.delist(index);
      }
    },
    "index-of": {
      type: parse.type('index-of %a = [%a] -> numeric'),
      compile: function(list, _arg, tvars) {
        var needle, type;
        needle = _arg[0];
        type = tvars.get('a');
        return list.foldList(Core.fail('index-of: element not found'), function(el, next, index) {
          return equals(el, needle, type).branch(index, next);
        });
      }
    },
    add: {
      type: parse.type('add numeric = numeric -> numeric'),
      compile: function(input, _arg) {
        var num;
        num = _arg[0];
        return input.op2('+', num);
      }
    },
    sub: {
      type: parse.type('sub numeric = numeric -> numeric'),
      compile: function(input, _arg) {
        var num;
        num = _arg[0];
        return input.op2('+', num.op1('-'));
      }
    },
    mul: {
      type: parse.type('mul numeric = numeric -> numeric'),
      compile: function(input, _arg) {
        var num;
        num = _arg[0];
        return input.op2('*', num);
      }
    },
    div: {
      type: parse.type('div numeric = numeric -> numeric'),
      compile: function(input, _arg) {
        var num;
        num = _arg[0];
        num = num.failIf('division by zero', function(n) {
          return n.op2('===', ZERO);
        });
        return input.op2('/', num);
      }
    },
    id: {
      type: parse.type('id = %a -> %a'),
      compile: function(input) {
        return input;
      }
    },
    "else": {
      type: parse.type('else = % -> bool'),
      compile: function(_) {
        return TRUE;
      }
    },
    not: {
      type: parse.type('not = bool -> bool'),
      compile: function(input) {
        return input.op1('!');
      }
    },
    gt: {
      type: parse.type('gt numeric = numeric -> bool'),
      compile: function(input, _arg) {
        var num;
        num = _arg[0];
        return input.op2('>', num);
      }
    },
    lt: {
      type: parse.type('lt numeric = numeric -> bool'),
      compile: function(input, _arg) {
        var num;
        num = _arg[0];
        return input.op2('<', num);
      }
    },
    gte: {
      type: parse.type('gt numeric = numeric -> bool'),
      compile: function(input, _arg) {
        var num;
        num = _arg[0];
        return input.op2('>=', num);
      }
    },
    lte: {
      type: parse.type('lt numeric = numeric -> bool'),
      compile: function(input, _arg) {
        var num;
        num = _arg[0];
        return input.op2('<=', num);
      }
    },
    eq: {
      type: parse.type('eq %a = %a -> bool'),
      compile: function(input, _arg, tvars) {
        var obj;
        obj = _arg[0];
        return equals(input, obj, tvars.get('a'));
      }
    },
    neq: {
      type: parse.type('neq %a = %a -> bool'),
      compile: function(input, _arg, tvars) {
        var obj;
        obj = _arg[0];
        return equals(input, obj, tvars.get('a')).op1('!');
      }
    },
    t: {
      type: parse.type('t = % -> bool'),
      compile: function() {
        return TRUE;
      }
    },
    f: {
      type: parse.type('f = % -> bool'),
      compile: function() {
        return FALSE;
      }
    },
    assert: {
      type: parse.type('assert { %a -> bool } = %a -> %a'),
      compile: function(input, _arg) {
        var block;
        block = _arg[0];
        return block.app(input).branch(input, Core.fail('assert'));
      }
    },
    "assert-any": {
      type: parse.type('assert-any = [%a] -> [%a]'),
      compile: function(input) {
        return input.len().op2('>', Core.constant(0)).branch(input, Core.fail('assert-any'));
      }
    }
  };
})();

Value = Gibbon.Value = Value = (function(_super) {
  __extends(Value, _super);

  function Value() {
    _ref15 = Value.__super__.constructor.apply(this, arguments);
    return _ref15;
  }

  Value.variants({
    string: ['value'],
    number: ['value'],
    boolean: ['value'],
    block: ['fn'],
    list: ['elements'],
    pair: ['first', 'second'],
    entity: ['type', 'id']
  });

  Value.fromJSON = function(o) {
    var e;
    if (typeof o === 'boolean') {
      return Value.boolean(o);
    }
    if (typeof o === 'number') {
      return Value.number(o);
    }
    if (typeof o === 'string') {
      return Value.string(o);
    }
    if (isArray(o)) {
      return Value.list((function() {
        var _i, _len, _results;
        _results = [];
        for (_i = 0, _len = o.length; _i < _len; _i++) {
          e = o[_i];
          _results.push(Value.fromJSON(e));
        }
        return _results;
      })());
    }
    switch (o._tag) {
      case 'entity':
        return Value.entity(o.type, o.id);
      case 'pair':
        return Value.pair(o.first, o.second);
    }
    throw new Error('invalid value: ' + o);
  };

  Value.interpret = function(o, type) {
    var bail,
      _this = this;
    bail = function(expected) {
      throw "bad value (expected " + expected + "): " + (inspectNative(o));
    };
    return type.cases({
      pair: function(first, second) {
        if (!('first' in o && 'second' in o)) {
          bail('a pair');
        }
        return Value.pair(_this.interpret(o.first, first), _this.interpret(o.second, second));
      },
      list: function(listOf) {
        var e;
        if (!isArray(o)) {
          bail('a list');
        }
        return Value.list((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = o.length; _i < _len; _i++) {
            e = o[_i];
            _results.push(this.interpret(e, listOf));
          }
          return _results;
        }).call(_this));
      },
      entity: function(type) {
        if (typeof o !== 'number') {
          bail('an entity id');
        }
        return Value.entity(type, o);
      },
      numeric: function() {
        if (typeof o !== 'number') {
          bail('a number');
        }
        return Value.number(o);
      },
      string: function() {
        if (typeof o !== 'string') {
          bail('a string');
        }
        return Value.string(o);
      },
      bool: function() {
        if (typeof o !== 'boolean') {
          bail('a boolean');
        }
        return Value.boolean(o);
      },
      block: function(from, to) {
        return Value.block(o);
      },
      other: function() {
        throw "could not return object of type " + (type.inspect());
      }
    });
  };

  Value.prototype.asPrimitive = function() {
    return this.cases({
      string: function(v) {
        return v;
      },
      number: function(v) {
        return v;
      },
      boolean: function(v) {
        return v;
      },
      block: function(v) {
        return v;
      },
      list: function(els) {
        var e, _i, _len, _results;
        _results = [];
        for (_i = 0, _len = els.length; _i < _len; _i++) {
          e = els[_i];
          _results.push(e.asPrimitive());
        }
        return _results;
      },
      pair: function(first, second) {
        return {
          first: first.asPrimitive(),
          second: second.asPrimitive()
        };
      },
      entity: function(_, id) {
        return id;
      }
    });
  };

  Value.prototype.inspect = function() {
    return this.cases({
      list: function(els) {
        var e;
        return "(list " + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = els.length; _i < _len; _i++) {
            e = els[_i];
            _results.push(e.inspect());
          }
          return _results;
        })()).join(' ')) + ")";
      },
      pair: function(first, second) {
        return "(pair " + (first.inspect()) + " " + (second.inspect()) + ")";
      },
      entity: function(id) {
        return "(entity " + id + ")";
      },
      other: function() {
        return '' + this.asPrimitive();
      }
    });
  };

  return Value;

})(Variant);

Gibbon.Dependency = Dependency = (function(_super) {
  __extends(Dependency, _super);

  function Dependency() {
    _ref16 = Dependency.__super__.constructor.apply(this, arguments);
    return _ref16;
  }

  Dependency.variants({
    query: ['entity', 'query', 'value'],
    lexical: ['key'],
    failure: ['entity', 'query']
  });

  Dependency.prototype.equals = function(other) {
    if (this._tag !== other._tag) {
      return false;
    }
    return this.cases({
      query: function(entity, query) {
        if (entity !== other.entity) {
          return false;
        }
        if (JSON.stringify(query) !== JSON.stringify(other.query)) {
          return false;
        }
        return true;
      },
      lexical: function(key) {
        return key === other.key;
      },
      failure: function(entity, query) {
        return entity === other.entity && JSON.stringify(query) === JSON.stringify(other.query);
      }
    });
  };

  Dependency.prototype.inspect = function() {
    return this.cases({
      query: function(entity, query) {
        return "(query " + entity + ":" + (JSON.stringify(query)) + ")";
      },
      lexical: function(key) {
        return "(lexical " + key + ")";
      },
      failure: function(entity, query) {
        return "(failure " + entity + " " + (JSON.stringify(query)) + ")";
      }
    });
  };

  return Dependency;

})(Variant);

Gibbon.Failure = Failure = (function(_super) {
  __extends(Failure, _super);

  function Failure() {
    _ref17 = Failure.__super__.constructor.apply(this, arguments);
    return _ref17;
  }

  Failure.variants({
    query: ['id', 'annotations'],
    message: ['message']
  });

  Failure.prototype.equals = function(other) {
    if (this._tag !== other._tag) {
      return false;
    }
    return this.cases({
      query: function(id, annotations) {
        if (annotations !== other.annotations) {
          return false;
        }
        if (id !== other.id) {
          return false;
        }
      },
      message: function(m) {
        return m === other.message;
      },
      composite: function(failures) {
        var failure, i, _i, _len;
        for (i = _i = 0, _len = failures.length; _i < _len; i = ++_i) {
          failure = failures[i];
          if (!failure.equals(other.failures[i])) {
            return false;
          }
        }
        return true;
      }
    });
  };

  return Failure;

})(Variant);

Gibbon.Result = Result = (function(_super) {
  __extends(Result, _super);

  function Result() {
    _ref18 = Result.__super__.constructor.apply(this, arguments);
    return _ref18;
  }

  Result.variants({
    success: ['dependencies', 'value'],
    failure: ['dependencies', 'failure']
  });

  return Result;

})(Variant);

Gibbon.CompiledCode = CompiledCode = (function() {
  var idFor, trampoline;

  idFor = function(key) {
    return 'local' + key.replace(/\//g, '$$$$').replace(/-/g, '$$_');
  };

  trampoline = function(x) {
    while (typeof x === 'function') {
      x = x();
    }
    return x;
  };

  function CompiledCode(semantics, blocks) {
    var _this = this;
    this.semantics = semantics;
    this.blocks = blocks;
    this.functions = new Hash;
    this.blocks.each(function(k, v) {
      var func;
      func = new Function('$', 'QUERY', 'FAIL', 'RETURN', v);
      return _this.functions.set(k, func);
    });
  }

  CompiledCode.prototype.functionFor = function(key) {
    return this.functions.get(key) || (function() {
      throw "no such key " + key;
    })();
  };

  CompiledCode.prototype.run = function(input, client, resultCallback) {
    var dependencies, failures, mapper, mkQuery, results, runKey,
      _this = this;
    results = new Hash;
    dependencies = new Hash;
    failures = new Hash;
    runKey = function(key, fail, succeed) {
      var deps, onFailure, onSuccess, query;
      if (results.has(key)) {
        
        return succeed(results.get(key));
      }
      if (failures.has(key)) {
        
        return fail(failures.get(key));
      }
      
      deps = dependencies.set(key, []);
      query = mkQuery(function(d) {
        
        return deps.push(d);
      });
      onSuccess = function(data) {
        
        results.set(key, data);
        return succeed(data);
      };
      onFailure = function(err) {
        if (typeof err === 'string') {
          err = Failure.message(err);
        }
        
        failures.set(key, err);
        return fail(err, dependencies);
      };
      return _this.functionFor(key)(input, query, onFailure, onSuccess);
    };
    mkQuery = function(pushDep) {
      return function(id, analysis, onFailure, onSuccess) {
        var annotations, isSynchronous, out;
        if (id == null) {
          pushDep(Dependency.lexical(analysis));
          return runKey(analysis, onFailure, onSuccess);
        }
        annotations = analysis.annotations;
        isSynchronous = true;
        out = client.performQuery(id, annotations, function(err, data) {
          var publicValue;
          if (err) {
            pushDep(Dependency.failure(id, annotations));
            if (isSynchronous) {
              return function() {
                return onFailure(err);
              };
            } else {
              return trampoline(onFailure(err));
            }
          } else {
            publicValue = Value.interpret(data, Type.fromSexpr(analysis.type));
            pushDep(Dependency.query(id, annotations, publicValue));
            if (isSynchronous) {
              return function() {
                return onSuccess(data);
              };
            } else {
              return trampoline(onSuccess(data));
            }
          }
        });
        isSynchronous = false;
        return out;
      };
    };
    mapper = function(key, cb) {
      return trampoline(runKey(key, cb, cb));
    };
    return contMap(this.semantics.keys(), mapper, function() {
      var out;
      out = new Hash;
      results.each(function(k, v) {
        var deps, value;
        value = Value.interpret(v, _this.outputType(k));
        deps = dependencies.get(k);
        deps = uniq(deps, function(x, y) {
          return x.equals(y);
        });
        return out.set(k, Result.success(deps, value));
      });
      failures.each(function(k, v) {
        var deps;
        deps = dependencies.get(k);
        deps = uniq(deps, function(x, y) {
          return x.equals(y);
        });
        return out.set(k, Result.failure(deps, v));
      });
      return resultCallback(out);
    });
  };

  CompiledCode.prototype.outputType = function(key) {
    var e, type;
    try {
      type = this.semantics.get(key).flow.type;
      if (type == null) {
        throw "null type at " + key + ": " + (JSON.stringify(this.semantics));
      }
      if (!type.cases) {
        throw "type without cases at " + key + ": JSON.stringify(@semantics)}";
      }
      return type;
    } catch (_error) {
      e = _error;
      throw "" + e + " thrown at " + key + ": " + (JSON.stringify(this.semantics));
    }
  };

  return CompiledCode;

})();

Gibbon.compile = function(semantics) {
  var codegen, compiled, optimize, reduce, sequence, translate, translated;
  codegen = Gibbon.codegen, reduce = Gibbon.reduce, sequence = Gibbon.sequence, optimize = Gibbon.optimize, translate = Gibbon.translate;
  compiled = new Hash;
  translated = translate(semantics);
  translated.each(function(k, v) {
    return compiled.set(k, codegen(reduce(sequence(optimize(v)))).block.toJS());
  });
  return new CompiledCode(semantics, compiled);
};

Ruby = (function(_super) {
  var inspectLiteral;

  __extends(Ruby, _super);

  function Ruby() {
    _ref19 = Ruby.__super__.constructor.apply(this, arguments);
    return _ref19;
  }

  Ruby.variants({
    branch: ['cond', 'ifTrue', 'ifFalse'],
    guard: ['cond', 'expr'],
    rescue: ['expr', 'default'],
    ident: ['name'],
    brackets: ['expr', 'arg'],
    array: ['elements'],
    group: ['statements'],
    op1: ['op', 'arg'],
    op2: ['op', 'lhs', 'rhs'],
    assign: ['lval', 'rval'],
    paren: ['elements'],
    literal: ['value'],
    symbol: ['name'],
    mcall: ['target', 'name', 'args', 'blockArgs', 'block']
  });

  Ruby.raise = function(args) {
    return this.mcall(null, 'raise', args, [], null);
  };

  Ruby.breakUnless = function(cond) {
    return cond.op2('||', this.ident('break'));
  };

  Ruby.prototype.branch = function(t, f) {
    return Ruby.branch(this, t, f);
  };

  Ruby.prototype.rescue = function(d) {
    return Ruby.rescue(this, d);
  };

  Ruby.prototype.bracket = function(a) {
    return Ruby.brackets(this, a);
  };

  Ruby.prototype.op1 = function(o) {
    return Ruby.op1(o, this);
  };

  Ruby.prototype.op2 = function(o, e) {
    return Ruby.op2(o, this, e);
  };

  Ruby.prototype.assign = function(rval) {
    return Ruby.assign(this, rval);
  };

  Ruby.prototype.mcall = function(name, args, blockArgs, block) {
    if (args == null) {
      args = [];
    }
    if (blockArgs == null) {
      blockArgs = [];
    }
    if (block == null) {
      block = null;
    }
    return Ruby.mcall(this, name, args, blockArgs, block);
  };

  Ruby.prototype.guard = function(expr) {
    return Ruby.branch(this, expr, null);
  };

  inspectLiteral = function(o) {
    var e, k, v;
    if (isArray(o)) {
      return '[' + ((function() {
        var _i, _len, _results;
        _results = [];
        for (_i = 0, _len = o.length; _i < _len; _i++) {
          e = o[_i];
          _results.push(inspectLiteral(e));
        }
        return _results;
      })()) + ']';
    }
    switch (typeof o) {
      case 'string':
        return "'" + o.replace("'", "\\\\'") + "'";
      case 'boolean':
        return "" + o;
      case 'number':
        if (isNaN(o)) {
          throw "literal NaN not supported!";
        }
        if (o === Infinity) {
          return '(1.0/0)';
        } else if (o === -Infinity) {
          return '(-1.0/0)';
        } else {
          return "" + o;
        }
        break;
      case 'object':
        return '{' + ((function() {
          var _results;
          _results = [];
          for (k in o) {
            if (!__hasProp.call(o, k)) continue;
            v = o[k];
            _results.push(inspectLiteral(k) + '=>' + inspectLiteral(v));
          }
          return _results;
        })()).join(',') + '}';
      default:
        throw new Error("unknown literal " + o);
    }
  };

  Ruby.prototype.toRuby = function() {
    return this.cases({
      rescue: function(e, d) {
        return "begin;" + (e.toRuby()) + ";rescue E;" + (d.toRuby()) + ";end";
      },
      ident: function(name) {
        return name;
      },
      brackets: function(expr, arg) {
        return "" + (expr.toRuby()) + "[" + (arg.toRuby()) + "]";
      },
      array: function(elements) {
        var e;
        return "[" + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = elements.length; _i < _len; _i++) {
            e = elements[_i];
            _results.push(e.toRuby());
          }
          return _results;
        })()).join(',')) + "]";
      },
      group: function(statements) {
        var s;
        return "(" + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = statements.length; _i < _len; _i++) {
            s = statements[_i];
            _results.push(s.toRuby());
          }
          return _results;
        })()).join(';')) + ")";
      },
      op1: function(op, arg) {
        return "(" + op + " " + (arg.toRuby()) + ")";
      },
      op2: function(op, lhs, rhs) {
        return "(" + (lhs.toRuby()) + " " + op + " " + (rhs.toRuby()) + ")";
      },
      assign: function(lval, rval) {
        return "(" + (lval.toRuby()) + "=" + (rval.toRuby()) + ")";
      },
      paren: function(elements) {
        var e;
        return "(" + (((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = elements.length; _i < _len; _i++) {
            e = elements[_i];
            _results.push(e.toRuby());
          }
          return _results;
        })()).join(',')) + ")";
      },
      literal: function(value) {
        return inspectLiteral(value);
      },
      symbol: function(name) {
        return ":" + name;
      },
      branch: function(cond, ifTrue, ifFalse) {
        if (ifFalse != null) {
          return "if " + (cond.toRuby()) + " then " + (ifTrue.toRuby()) + " else " + (ifFalse.toRuby()) + " end";
        } else {
          return "if " + (cond.toRuby()) + " then " + (ifTrue.toRuby()) + " end";
        }
      },
      mcall: function(target, name, args, blockArgs, block) {
        var a, l, out;
        out = [];
        if (target != null) {
          out.push("" + (target.toRuby()) + ".");
        }
        out.push(name);
        if (args.length) {
          out.push("(" + (((function() {
            var _i, _len, _results;
            _results = [];
            for (_i = 0, _len = args.length; _i < _len; _i++) {
              a = args[_i];
              _results.push(a.toRuby());
            }
            return _results;
          })()).join(',')) + ")");
        }
        if (block) {
          out.push('{');
        }
        if (blockArgs.length) {
          out.push("|" + (((function() {
            var _i, _len, _results;
            _results = [];
            for (_i = 0, _len = blockArgs.length; _i < _len; _i++) {
              a = blockArgs[_i];
              _results.push(a.toRuby());
            }
            return _results;
          })()).join(',')) + "|");
        }
        if (block) {
          out.push(((function() {
            var _i, _len, _results;
            _results = [];
            for (_i = 0, _len = block.length; _i < _len; _i++) {
              l = block[_i];
              _results.push(l.toRuby());
            }
            return _results;
          })()).join(';'));
        }
        if (block) {
          out.push('}');
        }
        return out.join('');
      }
    });
  };

  return Ruby;

})(Variant);

Gibbon.compileRuby = (function() {
  var compileCore, id, idForLocal, lit, nextSym, nil;
  id = Ruby.ident;
  lit = Ruby.literal;
  nextSym = Ruby.symbol('next');
  nil = id('nil');
  idForLocal = function(key) {
    return '_local' + key.length + key.replace(/\//g, '_slash_').replace(/-/g, '_dash_');
  };
  compileCore = function(core, nextVar, currentKey) {
    var localOrElse, r;
    if (nextVar == null) {
      nextVar = null;
    }
    if (currentKey == null) {
      currentKey = '/';
    }
    r = function(c, n, k) {
      if (n == null) {
        n = nextVar;
      }
      if (k == null) {
        k = currentKey;
      }
      return compileCore(c, n, k);
    };
    localOrElse = function(key, errorCase, nonErrorFn) {
      var localId;
      localId = id(idForLocal(key));
      if (errorCase === void 0) {
        errorCase = Ruby.raise([localId.bracket(Ruby.symbol('error'))]);
      }
      nonErrorFn || (nonErrorFn = function(val) {
        return val;
      });
      return Ruby.group([id('__client').mcall('local_dependency!', [lit(currentKey), lit(key)]), localId.bracket(Ruby.symbol('status')).op2('==', Ruby.symbol('success')).branch(nonErrorFn(localId.bracket(Ruby.symbol('value'))), errorCase)]);
    };
    return core.cases({
      global: function() {
        return id('__global');
      },
      constant: function(value) {
        return lit(value);
      },
      variable: function(name) {
        if (nextVar === name) {
          return nextSym;
        } else {
          return id(name);
        }
      },
      branch: function(cond, t, f) {
        return r(cond).branch(r(t), r(f));
      },
      delist: function(expr, index) {
        return r(expr).bracket(r(index));
      },
      depair: function(expr, index) {
        index = index === 'first' ? 0 : 1;
        return r(expr).bracket(lit(index));
      },
      pair: function(first, second) {
        return Ruby.array([r(first), r(second)]);
      },
      list: function(elements) {
        var e;
        return Ruby.array((function() {
          var _i, _len, _results;
          _results = [];
          for (_i = 0, _len = elements.length; _i < _len; _i++) {
            e = elements[_i];
            _results.push(r(e));
          }
          return _results;
        })());
      },
      foldList: function(list, out, arg, accumArg, idxArg, body) {
        var iterArgs, iterBody, reversed;
        if (body.containsInNonTailPosition(Core.variable(accumArg))) {
          reversed = r(list).mcall('each_with_index').mcall('to_a').mcall('reverse');
          iterArgs = [id(accumArg), Ruby.paren([id(arg), id(idxArg)])];
          iterBody = [r(body)];
          return reversed.mcall('inject', [r(out)], iterArgs, iterBody);
        } else {
          body = [id(accumArg).assign(r(body, accumArg)), Ruby.breakUnless(id(accumArg).op2('==', nextSym))];
          return Ruby.group([id(accumArg).assign(nextSym), r(list).mcall('each_with_index', [], [id(arg), id(idxArg)], body), id(accumArg).op2('==', nextSym).branch(r(out), id(accumArg))]);
        }
      },
      mapList: function(list, arg, idxArg, body) {
        var blockArgs, target, _ref20;
        _ref20 = body.contains(Core.variable(idxArg)) ? [r(list).mcall('each_with_index'), [id(arg), id(idxArg)]] : [r(list), [id(arg)]], target = _ref20[0], blockArgs = _ref20[1];
        return target.mcall('map', [], blockArgs, [r(body)]);
      },
      filterList: function(list, arg, body) {
        return r(list).mcall('select', [], [id(arg)], [r(body)]);
      },
      squishList: function(list) {
        return list.cases({
          list: function(elements) {
            var e, out, statements, yielder, _i, _len;
            yielder = id(nameGen('y'));
            out = id(nameGen('out'));
            statements = [];
            statements.push(out.assign(Ruby.array([])));
            for (_i = 0, _len = elements.length; _i < _len; _i++) {
              e = elements[_i];
              if (e.alwaysSucceeds()) {
                statements.push(out.mcall('push', [r(e)]));
              } else {
                statements.push(e.cases({
                  localQuery: function(key) {
                    return localOrElse(key, null, function(value) {
                      return out.mcall('push', [value]);
                    });
                  },
                  other: function() {
                    return out.mcall('push', [r(e)]).rescue(nil);
                  }
                }));
              }
            }
            statements.push(out);
            return Ruby.group(statements);
          },
          other: function() {
            throw "can't squish a non-list node";
          }
        });
      },
      zipLists: function(first, second) {
        return r(first).mcall('zip', [r(second)]);
      },
      len: function(list) {
        return r(list).mcall('size');
      },
      block: function(name, body) {
        return Ruby.mcall(null, 'lambda', [], [id(name)], [r(body)]);
      },
      app: function(block, arg) {
        return r(block).mcall('call', r(arg));
      },
      query: function(expr, annotations) {
        var type, _ref20;
        _ref20 = annotations, annotations = _ref20.annotations, type = _ref20.type;
        return id('__client').mcall('query!', [lit(currentKey), lit(annotations), lit(type), r(expr)]);
      },
      localQuery: function(key) {
        return localOrElse(key);
      },
      fail: function(message) {
        return Ruby.raise([id('E'), lit(message)]);
      },
      rescue: function(expr, def) {
        return expr.cases({
          local: function(key) {
            return localOrElse(key, r(def));
          },
          other: function() {
            return r(expr).rescue(r(def));
          }
        });
      },
      op1: function(o, expr) {
        return r(expr).op1(o);
      },
      op2: function(o, lhs, rhs) {
        if (o === '===') {
          o = '==';
        }
        if (o === "/") {
          return Ruby.mcall(r(lhs), "fdiv", [r(rhs)], [], null);
        } else {
          return r(lhs).op2(o, r(rhs));
        }
      },
      bind: function(name, value, expr) {
        return Ruby.group([id(name).assign(r(value)), r(expr)]);
      }
    });
  };
  return function(semantics) {
    var key, keys, optimize, out, processKey, seen, translate, translated, _i, _len;
    optimize = Gibbon.optimize, translate = Gibbon.translate;
    keys = semantics.keys();
    seen = new Hash;
    out = [];
    translated = translate(semantics);
    processKey = function(key) {
      var compiledRuby, dep, _i, _len, _ref20;
      if (seen.has(key)) {
        return;
      }
      seen.set(key, true);
      _ref20 = semantics.get(key).dependencies;
      for (_i = 0, _len = _ref20.length; _i < _len; _i++) {
        dep = _ref20[_i];
        if (dep._tag === 'local') {
          processKey(dep.name);
        }
      }
      compiledRuby = compileCore(optimize(translated.get(key)), null, key).toRuby();
      return out.push("" + (idForLocal(key)) + " = begin\n  {:status=>:success,:value=>(" + compiledRuby + ")}\nrescue E => e\n  {:status=>:failure,:error=>e}\nend");
    };
    for (_i = 0, _len = keys.length; _i < _len; _i++) {
      key = keys[_i];
      processKey(key);
    }
    out.push('{');
    out.push(((function() {
      var _j, _len1, _results;
      _results = [];
      for (_j = 0, _len1 = keys.length; _j < _len1; _j++) {
        key = keys[_j];
        _results.push("" + (lit(key).toRuby()) + " => " + (idForLocal(key)));
      }
      return _results;
    })()).join(','));
    out.push('}');
    
    return out.join("\n");
  };
})();

Gibbon.jsonConsumer = (function() {
  return function(tables) {
    var analyzeList, getType, getValue, listLookup, lists;
    getType = function(id, accessorName, t, callback) {
      var fields;
      if (!tables.hasOwnProperty(id)) {
        return {
          success: false,
          error: new Error("no such type " + id)
        };
      }
      fields = tables[id].fields;
      if (!fields.hasOwnProperty(accessorName)) {
        return {
          success: false,
          error: new Error("" + id + " has no field " + accessorName)
        };
      }
      return {
        success: true,
        analysis: {
          type: fields[accessorName],
          annotations: {
            name: accessorName,
            table: id
          }
        }
      };
    };
    getValue = function(id, annotations, callback) {
      var entity, values;
      if (!tables.hasOwnProperty(annotations.table)) {
        throw new Error("no such type " + annotations.table);
      }
      values = tables[annotations.table].values;
      if (!values[id]) {
        return callback(Failure.query(id, annotations));
      }
      entity = values[id];
      if (!(entity.hasOwnProperty(annotations.name) && (entity[annotations.name] != null))) {
        return callback(Failure.query(id, annotations));
      }
      return callback(null, entity[annotations.name]);
    };
    lists = tables._lists || {};
    analyzeList = function(id, listName, t, callback) {
      var list;
      if (!lists.hasOwnProperty(listName)) {
        ({
          success: false,
          error: new Error("unkown list `" + listName + "'")
        });
      }
      list = lists[listName];
      if (id !== list.type) {
        ({
          success: false,
          error: new Error("wrong type " + id + " for list `" + listName + "'")
        });
      }
      return {
        success: true,
        analysis: {
          type: t.bool(),
          annotations: {
            list: listName
          }
        }
      };
    };
    listLookup = function(id, listName, callback) {
      var list;
      list = lists[listName].values;
      if (list.indexOf(id) >= 0) {
        return callback(null, true);
      } else {
        return callback(null, false);
      }
    };
    return {
      analyzeQuery: function(id, query, t, callback) {
        switch (query.type) {
          case 'access':
            return getType(id, query.args[0], t);
          case 'on':
            return analyzeList(id, query.args[0], t);
          default:
            return {
              success: false,
              error: new Error("unknown query `" + query.type + "'")
            };
        }
      },
      performQuery: function(id, annotations, callback) {
        if ('list' in annotations) {
          return listLookup(id, annotations.list, callback);
        } else {
          return getValue(id, annotations, callback);
        }
      }
    };
  };
})();
  return Gibbon;
})();

