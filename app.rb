require 'pathname'

class GibbonLexer < Rouge::RegexLexer
  tag 'gibbon'

  state :basic do
    rule %r(\s+), Text
    rule %r(#.*?\n), Comment
  end

  state :root do
    mixin :basic
    rule %r(\d+%), Num
    rule %r(\d+), Num
    rule %r('.*?'), Str

    rule %r(^[\w-]+:.*?\n), Name::Attribute
    rule %r(:=), Punctuation
    rule %r(->), Punctuation
    rule %r(\[\*), Punctuation
    rule %r(\*\]), Punctuation
    rule %r([=|(){}\[\]:,]), Punctuation
    rule %r([\w-]+), Name
    rule %r(@[\w-]+), Name::Function
    rule %r([.][\w-]+), Name::Variable
    rule %r([%][\w-]+), Name::Variable

    rule %r((@:[\w-]+)(\[)) do
      groups Name::Function, Punctuation
      push :query
    end
  end

  state :query do
    mixin :basic
    rule %r([\w-]+), Name::Variable
    rule %r(\]), Punctuation, :pop!
  end
end

class GibbonPadApp < Sinatra::Application
  BASE = Pathname.new(__FILE__).dirname
  VENDOR = BASE.join('vendor')

  configure do
    set :root, BASE
    set :views, BASE.join('views')
  end

  get '/' do
    erb :index
  end

  get '/doc' do
    source = VENDOR.join('user-guide.md').read
    @doc = Kramdown::Document.new(source, syntax_highlighter: 'rouge').to_html
    erb :doc
  end
end
