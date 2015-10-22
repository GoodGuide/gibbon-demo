FROM goodguide/base-ruby:2.1.2

ENV RACK_ENV production
EXPOSE 8080
WORKDIR /app/
CMD ./bin/unicorn -l 0.0.0.0:8080

ADD Gemfile /app/
ADD Gemfile.lock /app/
RUN bundle install --binstubs --retry 3 --jobs 4

ADD app.rb /app/app.rb
ADD config.ru /app/config.ru
ADD public /app/public
ADD views /app/views
ADD vendor /app/vendor
