## Intro

Gibbon is the language that underlies all of PurView's configurations.  It
is meant to be small, simple, and easy to understand by people who don't
have any programming experience, but are comfortable with tools like excel.

This document is meant as a reference for someone trying to implement a gibbon
rule. To start, you can experiment with the language in the [sandbox](/) to test out, verify, or correct any of the information here.

## Basic Types

### numeric

Numbers are integer or floating point numbers, i.e. `3` or `3.2`.

### bool

Booleans are true (`t`) or false (`f`).

### string

Strings are notated with single quotes, as in `'foo'`

### entity

Entities represent an entity that can be queried.  It contains a unique identifier as part of its type,
so for example an entity from catalog 123 is of type `(entity 123)`), which is a different type than an
entity from catalog 456, of type `(entity 456)`.

### list

A *list* is a possibly empty list of values of the same type.  They are notated
with square brackets (`[ ... ]`):


~~~ gibbon
# These are equivalent, both of type (list numeric).

[1, 2, 3]
[
  1
  2
  3
]
~~~

### pair
A *pair* is two expressions joined by a colon:

~~~ gibbon
1 : 'foo'
~~~

The result is an ordered pair of values.  The values can be of different types, and the values can be
extracted with the `first` and `second` functions (see `List of Functions`).

### block
A *block* is a gibbon expression that can be executed in a different context (see `Blocks, Context`).
It is represented by some gibbon code in between curly braces (`{ ... }`).

## Functions, Queries
Functions are called with **arguments** and a **chain input**.  A function call looks like:

~~~ gibbon
# this is 5
3 -> add 2
~~~

In this example, the function `add` is being called with argument `2` and input `3`.
Function calls can be chained together, for example:

~~~ gibbon
# this is 50
3 -> add 2 -> mul 10
~~~

A **query** is a special kind of function that takes no arguments and expects an entity
as its input. The simplest query type is **access**:

~~~ gibbon
@:access[some-named-field]
~~~

In Purview, this results in the value of the field `some-named-field` for the given
entity.  Access queries are so common that there is a shorter notation for them. The
above expression is equivalent to

~~~ gibbon
@some-named-field
~~~

If a function call or query doesn't have an explicit input using `->`, the input
is taken to be the default input for that context - usually the entity on which
the rule is being computed.

Queries other than `access` are specified outside of gibbon by Purview - see
below for a list of the query types supported by Purview.

## "Missing", Rescue, Squish
Often, when a value is requested from a query, it isn't possible to retrieve
the value because it is blank.  Rather than returning a nil value, Gibbon
considers this expression "missing".  Any expression that depends on a "missing"
value is also missing.  For example:

~~~ gibbon
@some-query -> add 2
~~~

on an entity for which `some-query` is missing, is also missing.  There are
three ways of dealing with missing values in Purview.  The simplest is to just
let them propagate - often it's not possible to compute a score if the data
is missing.  Another option is to set a default value on the field within Purview -
that way, when the rule fails to compute, Purview will consider the value
of the field to be that default.  Finally, if there is more complex reasonable
default behavior when data is missing, you can handle the failure within gibbon
code.

There are two ways to recover from missing data.  The first, straightforward way
is with a simple **rescue** expression:

~~~ gibbon
some-expression | some-other-expression
~~~

In this case, if `some-expression` is missing, the result will be
`some-other-expression`.  For example,

~~~ gibbon
@some-field | 4
~~~

returns the value of `some-field` on the given entity, or 4 if it hasn't been
entered.

The other way to recover from missing data in gibbon is a **squish list**.  A
squish list is a special notation for lists that results in a list of all
the elements that are not missing.  They are delimited by square brackets with
stars:

~~~ gibbon
[* @field-one, @field-two, @field-three *]
~~~

In this case, if `field-two` is missing, the resulting list will only contain
the other two values.  This is in contrast to a regular list, in which any
of the values being missing would cause the whole list expression to be missing.

Importantly, empty lists are not missing - they are lists that have no elements.
To fail if a list is empty, send it through the `assert-any` function.

## Blocks, Context
A block is a snippet of gibbon code that is run in a different context. For
example,

~~~ gibbon
@ingredients -> map { @score }
~~~

The `map` function accepts a list as input and a block as an argument, and it
runs that block on each element of the input list and collects the results.

In this example, the block `{ @score }` is a snippet of gibbon code that
can be run in different contexts. The `map` function ensures that the
input to `@score` is not the current entity being computed, but rather
one of its ingredients.

## Definitions, Variables, Metadata

Often, you want to name intermediate values to break your computation down
into more manageable chunks.  For this, you use a **local definition**:

~~~ gibbon
my-variable := some -> expression
~~~

To recall the value of the variable, you prefix the name with a dot:

~~~ gibbon
.my-variable
~~~

## Builtin Functions

### How to read type syntax

The type of gibbon functions specifies the relationship between the types of its
arguments, its flow input, and its output.  So a function that looks like:

~~~ gibbon
foo type-1 = type-2 -> type-3
~~~

is a function called `foo` that accepts an argument of `type-1` and an input of `type-2`, and
returns a value of `type-3`.  The specific types are:

* `bool`: true or false
* `numeric`: a number
* `string`: a string
* `%a`: a type variable - used to indicate that two types are the same
* `%`: any type - used when the type doesn't matter
* `[type]`: a list of values of type `type`
* `type-1 : type-2`: a pair of values of type `type-1` and `type-2`
* `{ type-1 -> type-2 }`: a block that accepts an input of `type-1` and returns `type-2`.

### List of functions

#### `case [bool : %b] = % -> %b`

Receives a list of (boolean : value) pairs, returns the first value that's paired with true.
Ignores its flow input.

#### `case-eq [%a : %b] = %a -> %b`

Receives a list of pairs, returns the element on the right of the first pair whose
left element is equal to the flow input.

#### `case-eq-default %b [%a : %b] = %a -> %b`

Similar to `case-eq`, but accepts an additional argument to be used if no clause
matches.

#### `bucket [numeric : %b] = numeric -> %b`

Returns the right side of the first argument whose left side is greater than the input.

#### `any-true? = [bool] -> bool`

Returns true if any of the elements of the input list are true.  Given an empty list, this is false.

#### `all-true? = [bool] -> bool`

Returns true if all of the elements of the input list are true.  Given an empty list, this is true.

#### `any? { %a -> bool } = [%a] -> bool`

Returns true if any of the elements of the input list cause the block argument to be true. Given an empty list, this is false.

#### `all? { %a -> bool } = [%a] -> bool`

Returns true if all of the elements of the input list cause the block argument to be true. Given an empty list, this is true.

#### `include? %a = [%a] -> bool`

Returns true if the argument is in the input list.

#### `empty? = [%] -> bool`

Returns true if the input list is empty.

#### `missing = % -> %a`

Never returns a value - always fails to compute, in the same way as a missing data value would.

#### `weight [numeric : numeric] = % -> numeric`

Calculates a weighted average, with the values on the left and the weights on the right.

#### `mean = [numeric] -> numeric`

Calculates the mean of a list of numbers

#### `filter { %a -> bool } = [%a] -> [%a]`

Returns a list that contains only those elements of the list that cause the block argument to be true.

#### `map { %a -> %b } = [%a] -> [%b]`

Returns a new list whose elements are the outputs of the block argument given the input list's elements.

#### `count = [%a] -> numeric`

Returns the number of elements in the input list.

#### `sum = [numeric] -> numeric`

Returns the sum of a list of numbers.

#### `max = [numeric] -> numeric`

Returns the maximum element of a list of numbers. Given an empty list, this is missing.

#### `min = [numeric] -> numeric`

Returns the minimum element of a list of numbers. Given an empty list, this is missing.

#### `case-sum [bool : numeric] = % -> numeric`

Returns a sum of the right sides, but only those that are paired with true.

#### `first = [%a] -> %a`

Returns the first element of a list.  Given an empty list, this is missing.

#### `left = (%a : %b) -> %a`

Returns the left side of a pair.

#### `right = (%a : %b) -> %b`

Returns the right side of a pair.

#### `at numeric = [%a] -> %a`

Returns the nth element of the input list, where the first element is index 0.  If the argument
is greater than the number of elements, this is missing.

#### `index-of %a = [%a] -> numeric`

Returns the position of its argument in the input list.  If the element is not contained
in the list, this is missing.

#### `add numeric = numeric -> numeric`

Adds two numbers.

#### `sub numeric = numeric -> numeric`

Subtracts its argument from its input.

#### `mul numeric = numeric -> numeric`

Multiplies two numbers.

#### `div numeric = numeric -> numeric`

Divides its argument by its input.

#### `id = %a -> %a`

Returns its input.

#### `else = % -> bool`

An alias for `t`.  Is always true.

#### `not = bool -> bool`

Returns the boolean negation of its input.

#### `gt numeric = numeric -> bool`

Returns true if the input is greater than the argument.

#### `lt numeric = numeric -> bool`

Returns true if the input is less than the argument.

#### `gte numeric = numeric -> bool`

Returns true if the input is greater than or equal to the argument.

#### `lte numeric = numeric -> bool`

Returns true if the input is less than or equal to the argument.

#### `eq %a = %a -> bool`

Returns true if the input is equal to the argument.

#### `neq %a = %a -> bool`

Returns true if the input is not equal to the argument.

#### `t = % -> bool`

Returns true.

#### `f = % -> bool`

Returns false.

#### `assert { %a -> bool } = %a -> %a`

Returns the input if the block returns true, otherwise is missing.

#### `assert-any = [%a] -> [%a]`

Returns the input list if it contains any elements, otherwise is missing.

## List of queries supported by Purview

Queries always take an entity as input.

#### `@:access[field-name]`

Type: inferred from the field configuration.

Equivalent to `@field-name`.  Returns the value of the entity at the field `field-name`. This is missing if the entity has no value at the given field.

#### `@:on[catalog-name]`

Type: boolean

Returns true if the input entity is on the catalog (usually a hazard list or similar).

#### `@:ancestors`

Type: list of entities on the same catalog as the input.

Returns a list entities that are the ancestors (through a Child Entity Field) of the input entity.

#### `@:segments-of[field-name]`

Type: list of strings.

Returns a list of segments matched by the field's required-value regular expression.

#### `@:segment-named[field-name segment-name]`

Type: string

Returns the named match corresponding to segment-name matched by the fields's required-value regular expression.

#### `@:access-with-concentration[field-name]`

Type: `(%a : string)`, where `%a` is inferred from the field configuration.

Returns a pair of (value : concentration) for the field.  Requires the concentration to be a string (for back-compatibility reasons).

#### `@:access-with-numerical-concentration[field-name]`

Type: `(%a : numeric)`, where `%a` is inferred from the field configuration.

Similar to `access-with-concentration`, but expects the concentration to be numeric.

## Examples with Explanations

### map with bucket

~~~ gibbon
[ 1, 2, 3 ] -> map { bucket [
  1: 'low'
  3: 'high'
] }
~~~

This example returns a list of strings: `['low', 'high', 'high']`.

We've started with the list `[1, 2, 3]`, and *mapped* over it with the `map` function and a block. The block is then called
with each element as its input.  We send the input through `bucket`, which accepts a list of pairs, indicating the
delimiters and value for the bucketing operation.  In this case, we've said that anything not exceeding 1 should map to
'low', and anything not exceeding 3 should map to 'high'.  So 1 is mapped to 'low', and 2 and 3 are mapped to 'high'.

### case-eq

~~~ gibbon
@dyeing_method -> case-eq [
  'not' : 10
  'waterless' : 8
  'reduced_water' : 5
  'traditional' : 0
  'unknown' : 0
] | 0
~~~

This example assigns a score to several possibilities of a string value.

We start by looking up the `@dyeing_method` field of the entity, which returns a string.
Then we send it through `case-eq` with a list of pairs of test values and result values.
If `@dyeing_method` is equal to any of the values on the left, this rule will return
the value on the right.  If it's not equal to any of them, the result of `case-eq` will
be missing.  In this case we've defaulted that missing possibility to 0, so that our
rule is never missing.

### count of bad ingredients

~~~ gibbon
@ingredients -> filter { @:on[list-of-bad-ingredients] } -> count
~~~

This example returns the number of "bad ingredients" in the given entity, where "bad ingredient" is defined
as inclusion on a particular list.

We start by looking up the `@ingredients` field using an access query.  This gives us a list of ingredients,
since the field is configured as a list EntityField.  Then we pass that through a `filter`, to collect
all of the ingredients that cause the block to return true.  Inside the block, we query each element with
`@on:[list-of-bad-ingredients]` to check inclusion in `list-of-bad-ingredients`.  At this point, we have
a list of the the bad ingredients in the input entity.  Finally, we send this through `count` to count them
up.

### weighted average

~~~ gibbon
weight [*
  @score-a : 50
  @score-b : 25
  @score-c : 25
*]
~~~

This example returns a weighted average of the values of fields `@score-a`, `@score-b`, and `@score-c`.

Here we've used the `weight` function for weighted averages.  On the right are the weights associated with
values on the left.  But there's a wrinkle - here we've used a squish list.  So what happens when `@score-a`
is missing?  The first thing that happens is that the pair `@score-a : 50` is also missing.  The next is that
that pair is *removed from the list* because we've used a squish-list (`[* ... *]`).  So we're left with
a weighted average between the two values `@score-a` and `@score-b`.  Since they have the same weight,
this results in the regular mean of the two values.

If all three values are missing, we pass `weight` an empty list, which results in missing, since there's
no way to compute a weighted average of no values.
